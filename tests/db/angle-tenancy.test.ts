import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * An angle is a per-brand vocabulary row, but `creative_angles` stores the
 * angle as a STRING with no account column — so two brands that both use
 * "Pain" share the same assignment text. renameAngle / deleteAngle cascade to
 * assignments through a subquery of the ACTIVE brand's creatives
 * (app/actions/angle.ts); without it, renaming A's angle would silently
 * rewrite B's creatives. Through the real actions.
 */
const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: USER, role: "admin" })),
  auth: vi.fn(async () => ({ id: USER, role: "admin" })),
  can: vi.fn(() => true),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getActiveAccountId } from "@/lib/tenant";
import { angles, creativeAngles } from "@/db/schema";
import { createAngle, deleteAngle, renameAngle } from "@/app/actions/angle";
import { CREATIVE_1, CREATIVE_B, resetAndSeed } from "./fixtures";

const inBrand = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

const assignments = async (creativeId: string) =>
  (await db.select({ angle: creativeAngles.angle }).from(creativeAngles).where(eq(creativeAngles.creativeId, creativeId)))
    .map((r) => r.angle)
    .sort();
const vocabulary = async (acct: string) =>
  (await db.select({ name: angles.name }).from(angles).where(eq(angles.accountId, acct))).map((r) => r.name).sort();
const angleId = async (acct: string, name: string) =>
  (await db.select({ id: angles.id }).from(angles).where(and(eq(angles.accountId, acct), eq(angles.name, name))))[0]!.id;

beforeEach(async () => {
  await resetAndSeed();
  // Both brands carry the SAME angle string on one creative each.
  await db.insert(angles).values([
    { accountId: ACCOUNT_A, name: "Pain", createdByUserId: USER },
    { accountId: ACCOUNT_B, name: "Pain", createdByUserId: USER },
  ]);
  await db.insert(creativeAngles).values([
    { creativeId: CREATIVE_1, angle: "Pain" },
    { creativeId: CREATIVE_B, angle: "Pain" },
  ]);
  inBrand(ACCOUNT_A);
});

describe("angle mutations stay inside the active brand", () => {
  it("renaming A's angle follows A's creatives and leaves B's shared string alone", async () => {
    expect(await renameAngle(await angleId(ACCOUNT_A, "Pain"), "Pain v2")).toEqual({ ok: true });

    expect(await assignments(CREATIVE_1)).toEqual(["Pain v2"]);
    expect(await vocabulary(ACCOUNT_A)).toEqual(["Pain v2"]);
    expect(await assignments(CREATIVE_B)).toEqual(["Pain"]);
    expect(await vocabulary(ACCOUNT_B)).toEqual(["Pain"]);
  });

  it("deleting A's angle strips A's creatives only", async () => {
    expect(await deleteAngle(await angleId(ACCOUNT_A, "Pain"))).toEqual({ ok: true });

    expect(await assignments(CREATIVE_1)).toEqual([]);
    expect(await vocabulary(ACCOUNT_A)).toEqual([]);
    expect(await assignments(CREATIVE_B)).toEqual(["Pain"]);
    expect(await vocabulary(ACCOUNT_B)).toEqual(["Pain"]);
  });

  it("B's angle id is not found from A — no rename, no delete", async () => {
    const bPain = await angleId(ACCOUNT_B, "Pain");
    expect(await renameAngle(bPain, "Hijacked")).toEqual({ ok: false, error: "Angle not found." });
    expect(await deleteAngle(bPain)).toEqual({ ok: false, error: "Angle not found." });
    expect(await vocabulary(ACCOUNT_B)).toEqual(["Pain"]);
    expect(await assignments(CREATIVE_B)).toEqual(["Pain"]);
  });

  it("a name taken in B is free in A, and a clash inside A is refused", async () => {
    await db.insert(angles).values({ accountId: ACCOUNT_B, name: "Only in B", createdByUserId: USER });
    expect(await createAngle({ name: "Only in B" })).toEqual({ ok: true });
    expect(await createAngle({ name: "Pain" })).toEqual({ ok: false, error: "That angle already exists." });
    expect(await renameAngle(await angleId(ACCOUNT_A, "Only in B"), "Pain")).toEqual({
      ok: false,
      error: "Another angle already uses that name.",
    });
  });
});
