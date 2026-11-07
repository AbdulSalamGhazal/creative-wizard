import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * A Price Structure version as a comment + Activity entity (2026-11-07):
 * autosaves become ONE history line per person per section per sitting, the
 * version's Activity lists them with its create, and its thread is closed to
 * anyone holding none of the module's grants.
 */
const USER_ID = "11111111-1111-1111-1111-111111111111";
let grants: "all" | Set<string> = "all";
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requirePermission: vi.fn(async () => ({ id: USER_ID, role: "editor", permissions: [] })),
  requireAuth: vi.fn(async () => ({ id: USER_ID, role: "editor", permissions: [] })),
  auth: vi.fn(async () => ({ id: USER_ID, role: "editor", permissions: [] })),
  can: vi.fn((_user: unknown, perm: string) => grants === "all" || grants.has(perm)),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, comments, psUserState, psVersions } from "@/db/schema";
import { createVersion, saveVersion } from "@/app/actions/price-structure";
import { createComment } from "@/app/actions/comments";
import { entityActivityPage } from "@/db/queries/entity-activity";
import { resetAndSeed } from "./fixtures";

beforeAll(async () => {
  await resetAndSeed();
});

beforeEach(async () => {
  grants = "all";
  await db.delete(comments);
  await db.delete(psUserState);
  await db.delete(psVersions);
  await db.delete(auditEvents).where(eq(auditEvents.entityType, "price_structure"));
});

async function fresh() {
  const res = await createVersion({ name: "Main", from: { kind: "blank" } });
  if (!res.ok) throw new Error(res.error);
  return res.version;
}

const editLines = async (id: string) =>
  db
    .select({ meta: auditEvents.meta })
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, "price_structure.version_edit")))
    .orderBy(auditEvents.id);

describe("autosaves become one line per person per section per sitting", () => {
  it("repeat saves to the same section write one line; a new section writes another", async () => {
    const v = await fresh();
    let revision = v.revision;
    const save = async (patch: (d: typeof v.data) => void, name = v.name) => {
      const data = structuredClone(v.data);
      patch(data);
      v.data = data;
      const res = await saveVersion({ id: v.id, revision, name, notes: v.notes, data });
      if (!res.ok) throw new Error(res.error);
      revision = res.revision;
    };

    await save((d) => (d.settings = { ...d.settings, vatRate: 0.2 }));
    await save((d) => (d.settings = { ...d.settings, vatRate: 0.21 }));
    await save((d) => (d.settings = { ...d.settings, vatRate: 0.22 }), "Ramadan");

    expect((await editLines(v.id)).map((r) => (r.meta as { sections: string[] }).sections)).toEqual([
      ["settings"],
      ["name"],
    ]);
    // An unchanged save says nothing.
    const res = await saveVersion({ id: v.id, revision, name: "Ramadan", notes: v.notes, data: v.data });
    expect(res.ok).toBe(true);
    expect(await editLines(v.id)).toHaveLength(2);
  });

  it("the version's Activity lists its edits and its creation", async () => {
    const v = await fresh();
    const data = structuredClone(v.data);
    data.settings = { ...data.settings, usdToSar: 3.8 };
    await saveVersion({ id: v.id, revision: v.revision, name: v.name, notes: v.notes, data });
    const page = await entityActivityPage("ps_version", v.id, null);
    expect(page.rows.map((r) => r.action)).toEqual([
      "price_structure.version_edit",
      "price_structure.version_create",
    ]);
  });
});

describe("a version's thread is the module's members' only", () => {
  it("refuses a comment from someone with none of the three grants", async () => {
    const v = await fresh();
    grants = new Set();
    const refused = await createComment({ anchorType: "ps_version", anchorId: v.id, body: "Outside" });
    expect(refused.ok).toBe(false);

    grants = new Set(["price_structure.view"]);
    const ok = await createComment({ anchorType: "ps_version", anchorId: v.id, body: "Looks right" });
    expect(ok.ok).toBe(true);
  });

  it("refuses an id that isn't a version of this brand", async () => {
    const res = await createComment({
      anchorType: "ps_version",
      anchorId: "33333333-3333-3333-3333-333333333999",
      body: "Ghost",
    });
    expect(res.ok).toBe(false);
  });
});
