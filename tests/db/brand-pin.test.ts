import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * A commit is pinned to the brand its PREVIEW ran under (2026-11-01). The
 * Store upload, the bulk creative import and the Budget plan resolved the
 * brand from the cookie at commit, so a preview in brand A, a brand switch in
 * another tab, then Confirm wrote into brand B. Each commit now refuses a
 * moved brand with the stale-tab failure; through the REAL actions.
 */
const ADMIN = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures
const actor = {
  id: ADMIN, email: "harness@test.local", name: "Harness", role: "admin" as const,
  permissions: null, allAccounts: true, avatarUrl: null,
};
vi.mock("@/lib/auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...orig,
    auth: vi.fn(async () => actor),
    requireAuth: vi.fn(async () => actor),
    requirePermission: vi.fn(async () => actor),
  };
});
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getActiveAccountId } from "@/lib/tenant";
import { accounts, budgetAllocations, budgetPlanRevisions, creatives, storeOrderFields, storeOrders } from "@/db/schema";
import { coreFieldRows, systemRequiredFieldRows } from "@/store/fields";
import { commitStoreUpload, validateStoreUpload } from "@/app/actions/store-upload";
import { commitBulkCreatives, previewBulkCreatives } from "@/app/actions/creative-bulk";
import {
  convertPlanToCurve,
  copyBudgetFromMonth,
  restorePlanRevision,
  saveBudgetMonth,
  setUsdToSarRate,
} from "@/app/actions/budget";
import { getBudgetMonth, listPlanRevisions } from "@/db/queries/budget";
import { BRAND_CHANGED_MESSAGE } from "@/lib/action-failure";
import { resetAndSeed } from "./fixtures";

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);
const REFUSED = { ok: false, error: BRAND_CHANGED_MESSAGE, stale: true };

beforeEach(async () => {
  await resetAndSeed();
  setAccount(ACCOUNT_A);
});

describe("Store upload", () => {
  const form = () => {
    const fd = new FormData();
    fd.set("file", new File(["Order ID,Order date,Total,utm_source,channel\nPIN-1,2026-01-01,100,,\n"], "orders.csv"));
    fd.set("upsert", "false");
    return fd;
  };

  beforeEach(async () => {
    for (const acct of [ACCOUNT_A, ACCOUNT_B]) {
      await db.delete(storeOrderFields).where(eq(storeOrderFields.accountId, acct));
      await db.insert(storeOrderFields).values([
        ...coreFieldRows(acct).map((r) => ({
          ...r,
          headers: ({ order_id: ["order id"], order_date: ["order date"], total_amount: ["total"] } as Record<string, string[]>)[r.key] ?? [],
        })),
        ...systemRequiredFieldRows(acct),
      ]);
    }
  });

  it("refuses a commit whose brand moved since the preview — nothing lands in either brand", async () => {
    const preview = await validateStoreUpload(form());
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.brand).toBe(ACCOUNT_A);

    setAccount(ACCOUNT_B); // another tab switched brand
    const fd = form();
    fd.set("brand", preview.brand);
    expect(await commitStoreUpload(fd)).toEqual(REFUSED);
    expect(await db.select().from(storeOrders)).toHaveLength(0);
  });

  it("commits when the brand held", async () => {
    const preview = await validateStoreUpload(form());
    if (!preview.ok) throw new Error("preview failed");
    const fd = form();
    fd.set("brand", preview.brand);
    expect((await commitStoreUpload(fd)).ok).toBe(true);
    const rows = await db.select({ acct: storeOrders.accountId }).from(storeOrders);
    expect(rows).toEqual([{ acct: ACCOUNT_A }]);
  });
});

describe("bulk creative import", () => {
  const form = () => {
    const fd = new FormData();
    fd.set("file", new File(["name,product,type\nPin-Creative,Product A,video\n"], "creatives.csv"));
    return fd;
  };

  it("refuses a commit whose brand moved since the preview", async () => {
    const preview = await previewBulkCreatives(form());
    expect(preview.allValid).toBe(true);
    expect(preview.brand).toBe(ACCOUNT_A);

    setAccount(ACCOUNT_B);
    const fd = form();
    fd.set("brand", preview.brand!);
    expect(await commitBulkCreatives(fd)).toEqual(REFUSED);
    expect(await db.select().from(creatives).where(eq(creatives.name, "Pin-Creative"))).toHaveLength(0);
  });

  it("commits when the brand held", async () => {
    const preview = await previewBulkCreatives(form());
    const fd = form();
    fd.set("brand", preview.brand!);
    expect(await commitBulkCreatives(fd)).toMatchObject({ ok: true, created: 1 });
  });
});

describe("Budget plan save", () => {
  const plan = {
    month: "2026-01",
    allocations: [{ platform: "instagram", objective: "Other", plannedSpend: 1000 }],
    plannedRevenueSar: null,
    reserveSpendUsd: 0,
    dayWeights: [],
  };

  it("refuses a save whose brand moved since the page rendered", async () => {
    setAccount(ACCOUNT_B); // the page rendered in A; another tab switched to B
    expect(await saveBudgetMonth({ ...plan, brand: ACCOUNT_A })).toEqual(REFUSED);
    expect(await db.select().from(budgetAllocations).where(eq(budgetAllocations.accountId, ACCOUNT_B))).toHaveLength(0);
    expect(await db.select().from(budgetPlanRevisions).where(eq(budgetPlanRevisions.accountId, ACCOUNT_B))).toHaveLength(0);
  });

  it("saves when the brand held", async () => {
    expect((await saveBudgetMonth({ ...plan, brand: ACCOUNT_A })).ok).toBe(true);
  });
});

/**
 * The Budget plan page's OTHER writers (2026-11-01, finishing the class):
 * converting a daily month back to the editor, copying from another month,
 * restoring a revision, and the brand's USD→SAR rate. Each is pinned to the
 * brand the page rendered under, like the save.
 */
describe("the Budget plan page's other writers", () => {
  const MONTH = "2026-01";
  const curve = {
    month: MONTH,
    allocations: [{ platform: "instagram", objective: "Other", plannedSpend: 1000 }],
    plannedRevenueSar: null,
    reserveSpendUsd: 0,
    dayWeights: [],
  };
  const daily = {
    month: MONTH,
    mode: "daily",
    source: "upload",
    days: [{ day: 1, platform: "instagram", objective: "Awareness", plannedSpend: 100 }],
    allocations: [],
    plannedRevenueSar: null,
    reserveSpendUsd: 0,
    targetRoas: null,
    dayWeights: [],
  };
  const rateOf = async (acct: string) =>
    Number((await db.select({ r: accounts.usdToSarRate }).from(accounts).where(eq(accounts.id, acct)))[0]!.r);

  it("convertPlanToCurve refuses a moved brand — the daily month stays daily", async () => {
    expect((await saveBudgetMonth(daily)).ok).toBe(true);
    setAccount(ACCOUNT_B);
    expect(await convertPlanToCurve({ month: MONTH, brand: ACCOUNT_A })).toEqual(REFUSED);
    setAccount(ACCOUNT_A);
    expect((await getBudgetMonth(MONTH)).planMode).toBe("daily");
    expect((await convertPlanToCurve({ month: MONTH, brand: ACCOUNT_A })).ok).toBe(true);
  });

  it("copyBudgetFromMonth refuses a moved brand — nothing is copied into either", async () => {
    expect((await saveBudgetMonth(curve)).ok).toBe(true);
    setAccount(ACCOUNT_B);
    expect(await copyBudgetFromMonth({ month: "2026-02", from: MONTH, brand: ACCOUNT_A })).toEqual(REFUSED);
    expect(await db.select().from(budgetAllocations).where(eq(budgetAllocations.accountId, ACCOUNT_B))).toHaveLength(0);
    setAccount(ACCOUNT_A);
    expect((await copyBudgetFromMonth({ month: "2026-02", from: MONTH, brand: ACCOUNT_A })).ok).toBe(true);
  });

  it("restorePlanRevision refuses a moved brand", async () => {
    expect((await saveBudgetMonth(curve)).ok).toBe(true);
    const [rev] = await listPlanRevisions(MONTH);
    setAccount(ACCOUNT_B);
    expect(await restorePlanRevision({ revisionId: rev!.id, brand: ACCOUNT_A })).toEqual(REFUSED);
    setAccount(ACCOUNT_A);
    expect((await restorePlanRevision({ revisionId: rev!.id, brand: ACCOUNT_A })).ok).toBe(true);
  });

  it("setUsdToSarRate refuses a moved brand — neither brand's rate changes", async () => {
    const [a, b] = [await rateOf(ACCOUNT_A), await rateOf(ACCOUNT_B)];
    setAccount(ACCOUNT_B);
    expect(await setUsdToSarRate({ rate: 3.9, brand: ACCOUNT_A })).toEqual(REFUSED);
    expect([await rateOf(ACCOUNT_A), await rateOf(ACCOUNT_B)]).toEqual([a, b]);
    setAccount(ACCOUNT_A);
    expect((await setUsdToSarRate({ rate: 3.9, brand: ACCOUNT_A })).ok).toBe(true);
    expect(await rateOf(ACCOUNT_A)).toBe(3.9);
  });

  it("an old tab's bare-number rate still saves (no pin, no refusal)", async () => {
    expect((await setUsdToSarRate(3.8)).ok).toBe(true);
    expect(await rateOf(ACCOUNT_A)).toBe(3.8);
  });
});
