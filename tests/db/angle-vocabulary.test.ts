import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

// The actions are the units under test, so only the auth boundary is faked —
// validation, the transactions and every write run for real.
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: USER, role: "admin" })),
  auth: vi.fn(async () => ({ id: USER, role: "admin" })),
  can: vi.fn(() => true),
}));

import { db } from "@/lib/db";
import { angles } from "@/db/schema";
import { createCreative, patchCreative } from "@/app/actions/creative";
import { commitBulkCreatives } from "@/app/actions/creative-bulk";
import { listAngles } from "@/db/queries/angles";
import { listAllAngles } from "@/db/queries/creatives";
import { CREATIVE_1, PRODUCT_A, resetAndSeed } from "./fixtures";

/** This account's vocabulary, as the Angles tab would list it. */
const vocabulary = async (acct: string) =>
  (
    await db.select({ name: angles.name }).from(angles).where(eq(angles.accountId, acct))
  )
    .map((r) => r.name)
    .sort();

/** A bulk file with an angles column, as the upload form sends it. */
function bulkFile(lines: string[]): FormData {
  const csv = ["name,product,type,angles", ...lines].join("\n");
  const fd = new FormData();
  fd.set("file", new File([csv], "creatives.csv", { type: "text/csv" }));
  return fd;
}

beforeEach(async () => {
  await resetAndSeed();
});

/**
 * 2026-10-26: an angle typed on a creative used to reach `creative_angles`
 * only. The vocabulary (`angles`, the Library's Angles tab) grew through that
 * tab alone — or the dev seed — so a fresh brand's tab said "No angles yet"
 * while its creatives carried angles, and the tab's own empty state ("angles
 * get created when you assign one") had never been true. Every path that
 * writes an assignment now writes the vocabulary row in the same transaction,
 * through ONE helper (`addToVocabulary`).
 */
describe("an angle assigned to a creative joins the vocabulary", () => {
  it("patchCreative: account-scoped, idempotent, and the Angles tab lists it with its usage", async () => {
    expect(await vocabulary(ACCOUNT_A)).toEqual([]);

    const first = await patchCreative({ id: CREATIVE_1, angles: ["Hook", "Discount"] });
    expect(first.ok).toBe(true);
    expect(await vocabulary(ACCOUNT_A)).toEqual(["Discount", "Hook"]);
    expect(await vocabulary(ACCOUNT_B)).toEqual([]);

    // The same names again plus one more: no duplicate, no unique-violation.
    const again = await patchCreative({ id: CREATIVE_1, angles: ["Hook", "Discount", "UGC"] });
    expect(again.ok).toBe(true);
    expect(await vocabulary(ACCOUNT_A)).toEqual(["Discount", "Hook", "UGC"]);

    const tab = await listAngles();
    expect(tab.map((r) => [r.name, r.usage])).toEqual([
      ["Discount", 1],
      ["Hook", 1],
      ["UGC", 1],
    ]);
    // …and the dropdown's option list agrees with the tab.
    expect(await listAllAngles()).toEqual(["Discount", "Hook", "UGC"]);
  });

  it("un-assigning keeps the word: the vocabulary is curated on the Angles tab, not derived", async () => {
    await patchCreative({ id: CREATIVE_1, angles: ["Hook"] });
    const cleared = await patchCreative({ id: CREATIVE_1, angles: [] });
    expect(cleared.ok).toBe(true);
    expect(await vocabulary(ACCOUNT_A)).toEqual(["Hook"]);
    expect((await listAngles()).map((r) => [r.name, r.usage])).toEqual([["Hook", 0]]);
  });

  it("createCreative writes the vocabulary row with the creative", async () => {
    const res = await createCreative({
      name: "A-Creative-New",
      productId: PRODUCT_A,
      type: "video",
      angles: ["Launch", "Launch"],
    });
    expect(res.ok).toBe(true);
    expect(await vocabulary(ACCOUNT_A)).toEqual(["Launch"]);
    expect(await vocabulary(ACCOUNT_B)).toEqual([]);
  });

  it("the bulk import writes each of the file's angles once, in the same transaction", async () => {
    const res = await commitBulkCreatives(
      bulkFile(['Bulk-1,Product A,video,"Hook; Promo"', "Bulk-2,Product A,image,Hook"]),
    );
    expect(res.ok).toBe(true);
    expect(res.created).toBe(2);
    expect(await vocabulary(ACCOUNT_A)).toEqual(["Hook", "Promo"]);
    expect((await listAngles()).map((r) => [r.name, r.usage])).toEqual([
      ["Hook", 2],
      ["Promo", 1],
    ]);
  });

  // Atomicity is not asserted here because nothing after the vocabulary write
  // can fail (every validation runs before the transaction). What this suite
  // DOES pin, by running at production pool size (DB_POOL_MAX=1): the helper
  // takes the transaction. A copy that reached for `db` inside it would hang
  // every test above instead of shipping a prod deadlock (CLAUDE.md, Traps).
});
