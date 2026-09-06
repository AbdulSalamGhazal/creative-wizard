import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { angles, creativeAngles, creatives, users } from "@/db/schema";
import { listAngles } from "@/db/queries/angles";
import { resolvePermissions } from "@/lib/permissions";
import { resetAndSeed } from "./fixtures";

const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

const LEGACY_USER = "77777777-7777-7777-7777-777777777701";

beforeEach(async () => {
  await resetAndSeed();
  setAccount(ACCOUNT_A);
});

describe("angles (renamed from tags, migration 0037)", () => {
  it("the vocabulary + assignments survived the RENAME with their data", async () => {
    // A rename migration (not DROP+CREATE) means seeded rows are still here and
    // still joinable by string — the whole point of hand-writing 0037.
    const [creative] = await db
      .select({ id: creatives.id })
      .from(creatives)
      .where(eq(creatives.accountId, ACCOUNT_A))
      .limit(1);
    await db
      .insert(angles)
      .values({ accountId: ACCOUNT_A, name: "UGC-Hook" })
      .onConflictDoNothing();
    await db
      .insert(creativeAngles)
      .values({ creativeId: creative!.id, angle: "UGC-Hook" })
      .onConflictDoNothing();

    const rows = await listAngles();
    const ugc = rows.find((r) => r.name === "UGC-Hook");
    expect(ugc).toBeDefined();
    expect(ugc!.usage).toBe(1);
  });

  it("usage counts are account-scoped — B's assignment never inflates A's", async () => {
    const [aCreative] = await db
      .select({ id: creatives.id })
      .from(creatives)
      .where(eq(creatives.accountId, ACCOUNT_A))
      .limit(1);
    const [bCreative] = await db
      .select({ id: creatives.id })
      .from(creatives)
      .where(eq(creatives.accountId, ACCOUNT_B))
      .limit(1);
    // The SAME angle string in both brands (assignments are stored by string).
    await db.insert(angles).values([
      { accountId: ACCOUNT_A, name: "Shared" },
      { accountId: ACCOUNT_B, name: "Shared" },
    ]);
    await db.insert(creativeAngles).values([
      { creativeId: aCreative!.id, angle: "Shared" },
      { creativeId: bCreative!.id, angle: "Shared" },
    ]);

    const aRows = await listAngles();
    expect(aRows.find((r) => r.name === "Shared")!.usage).toBe(1);
    setAccount(ACCOUNT_B);
    const bRows = await listAngles();
    expect(bRows.find((r) => r.name === "Shared")!.usage).toBe(1);
  });

  it("the cascade stays bounded by an account-scoped creatives subquery", async () => {
    // CLAUDE.md invariant, carried over verbatim from creative_tags: because
    // creative_angles has NO account_id of its own, a rename/delete cascade must
    // be bounded by `creatives WHERE account_id` — otherwise a shared angle
    // string would be rewritten in the OTHER brand too.
    const [aCreative] = await db
      .select({ id: creatives.id })
      .from(creatives)
      .where(eq(creatives.accountId, ACCOUNT_A))
      .limit(1);
    const [bCreative] = await db
      .select({ id: creatives.id })
      .from(creatives)
      .where(eq(creatives.accountId, ACCOUNT_B))
      .limit(1);
    await db.insert(creativeAngles).values([
      { creativeId: aCreative!.id, angle: "Promo" },
      { creativeId: bCreative!.id, angle: "Promo" },
    ]);

    // The bounded cascade the angle actions perform.
    await db
      .update(creativeAngles)
      .set({ angle: "Promo-2" })
      .where(
        and(
          eq(creativeAngles.angle, "Promo"),
          sql`${creativeAngles.creativeId} IN (
            SELECT ${creatives.id} FROM ${creatives}
            WHERE ${creatives.accountId} = ${ACCOUNT_A}
          )`,
        ),
      );

    const bStill = await db
      .select({ angle: creativeAngles.angle })
      .from(creativeAngles)
      .where(eq(creativeAngles.creativeId, bCreative!.id));
    expect(bStill.map((r) => r.angle)).toContain("Promo"); // B untouched
    const aNow = await db
      .select({ angle: creativeAngles.angle })
      .from(creativeAngles)
      .where(eq(creativeAngles.creativeId, aCreative!.id));
    expect(aNow.map((r) => r.angle)).toContain("Promo-2");
  });

  it("a user whose stored permissions predate the rename still manages angles", async () => {
    // Seed the PRE-migration state: an explicit permission array still holding
    // the retired `catalog.tags` key.
    await db.insert(users).values({
      id: LEGACY_USER,
      email: "legacy-perms@test.local",
      name: "Legacy",
      role: "editor",
      permissions: ["upload.import", "catalog.tags"],
    });
    // Before the sweep the key is unknown to the catalog, so it resolves away —
    // this is exactly the silent capability loss migration 0037 prevents.
    const [before] = await db
      .select({ permissions: users.permissions })
      .from(users)
      .where(eq(users.id, LEGACY_USER));
    expect(resolvePermissions("editor", before!.permissions).has("catalog.angles")).toBe(false);

    // The sweep statement from migration 0037, verbatim in shape.
    await db.execute(sql`
      UPDATE "users"
      SET "permissions" = array_replace("permissions", 'catalog.tags', 'catalog.angles')
      WHERE "permissions" IS NOT NULL AND 'catalog.tags' = ANY("permissions")
    `);

    const [after] = await db
      .select({ permissions: users.permissions })
      .from(users)
      .where(eq(users.id, LEGACY_USER));
    expect(after!.permissions).toEqual(["upload.import", "catalog.angles"]);
    const resolved = resolvePermissions("editor", after!.permissions);
    expect(resolved.has("catalog.angles")).toBe(true);
    expect(resolved.has("upload.import")).toBe(true); // untouched neighbours
  });

  it("the saved-view sweep renames the tags= KEY and leaves look-alikes alone", async () => {
    // summary_views.query is a URL-encoded query STRING, so the filter is a
    // param KEY. Anchoring on (^|&) must not catch a param merely ending "tags".
    const rows = await db.execute(sql`
      SELECT
        regexp_replace('tags=UGC%2CPromo&platforms=instagram', '(^|&)tags=', '\\1angles=') AS a,
        regexp_replace('platforms=instagram&tags=UGC', '(^|&)tags=', '\\1angles=') AS b,
        regexp_replace('platforms=instagram&nottags=keepme', '(^|&)tags=', '\\1angles=') AS c
    `);
    const r = (rows as unknown as Array<Record<string, string>>)[0]!;
    expect(r.a).toBe("angles=UGC%2CPromo&platforms=instagram");
    expect(r.b).toBe("platforms=instagram&angles=UGC");
    expect(r.c).toBe("platforms=instagram&nottags=keepme"); // decoy untouched
  });
});
