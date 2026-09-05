import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { users } from "@/db/schema";
import {
  getBudgetMonth,
  rawMonthSpendTotal,
  replaceBudgetMonth,
  copyBudgetMonth,
} from "@/db/queries/budget";
import { writeStoreBatch } from "@/db/queries/store";
import { resetAndSeed } from "./fixtures";

const UPLOADER = "dddddddd-0000-0000-0000-0000000000f1";
const MONTH = "2026-01"; // the fixtures' perf month (incl. one EXCLUDED row)
const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

beforeEach(async () => {
  await resetAndSeed();
  setAccount(ACCOUNT_A);
});

describe("budget module — raw actuals, plans, scoping", () => {
  it("unplanned bucket invariant: combo totals == raw month total, EXCLUDED RECORDS INCLUDED", async () => {
    // Plan covers only (instagram, Sales); facebook spend exists with no plan.
    await replaceBudgetMonth(db, ACCOUNT_A, MONTH, {
      allocations: [{ platform: "instagram", objective: "Sales", plannedSpend: 1500 }],
      plannedRevenueSar: null,
    });

    const data = await getBudgetMonth(MONTH);
    const comboTotal = data.actualSpendByCombo.reduce((s, c) => s + c.actualSpend, 0);
    const raw = await rawMonthSpendTotal(MONTH);

    // Fixtures: 100+100 (IG) + 200 (FB) + 1000 (IG, excluded_from_aggregates=true).
    expect(raw).toBeCloseTo(1400, 2); // the excluded row IS counted — raw totals
    expect(comboTotal).toBeCloseTo(raw, 2); // the table reconciles exactly

    const fb = data.actualSpendByCombo.find((c) => c.platform === "facebook");
    expect(fb).toBeDefined(); // present as an Unplanned bucket (no plan row)
    expect(data.allocations.some((a) => a.platform === "facebook")).toBe(false);
  });

  it("copy-last-month replicates allocations + target; replace overwrites cleanly", async () => {
    await replaceBudgetMonth(db, ACCOUNT_A, "2026-01", {
      allocations: [
        { platform: "instagram", objective: "Sales", plannedSpend: 1000 },
        { platform: "facebook", objective: "Awareness", plannedSpend: 500 },
      ],
      plannedRevenueSar: 25000,
    });
    const copied = await copyBudgetMonth(db, ACCOUNT_A, "2026-01", "2026-02");
    expect(copied).toEqual({ allocations: 2, hasTarget: true });

    const feb = await getBudgetMonth("2026-02");
    expect(feb.allocations).toHaveLength(2);
    expect(feb.plannedRevenueSar).toBeCloseTo(25000, 2);
    expect(feb.prevMonthHasPlan).toBe(true); // Jan has a plan

    // Copying from an EMPTY month wipes the destination (replace semantics).
    const empty = await copyBudgetMonth(db, ACCOUNT_A, "2025-12", "2026-02");
    expect(empty).toEqual({ allocations: 0, hasTarget: false });
    expect((await getBudgetMonth("2026-02")).allocations).toHaveLength(0);
  });

  it("unique (account, month, platform, objective) refuses duplicate combos", async () => {
    await replaceBudgetMonth(db, ACCOUNT_A, MONTH, {
      allocations: [{ platform: "tiktok", objective: "Sales", plannedSpend: 100 }],
      plannedRevenueSar: null,
    });
    await expect(
      db.transaction(async (tx) => {
        // Direct duplicate insert (the action layer dedupes before this point).
        const { budgetAllocations } = await import("@/db/schema");
        await tx.insert(budgetAllocations).values({
          accountId: ACCOUNT_A,
          month: "2026-01-01",
          platform: "tiktok",
          objective: "Sales",
          plannedSpend: "999.00",
        });
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("is account-scoped — B sees neither A's plan nor A's actuals", async () => {
    await replaceBudgetMonth(db, ACCOUNT_A, MONTH, {
      allocations: [{ platform: "instagram", objective: "Sales", plannedSpend: 1000 }],
      plannedRevenueSar: 9000,
    });
    setAccount(ACCOUNT_B);
    const b = await getBudgetMonth(MONTH);
    expect(b.allocations).toHaveLength(0);
    expect(b.plannedRevenueSar).toBeNull();
    // B's own actuals only (fixtures give B one 777-spend instagram row in Jan).
    const bTotal = b.actualSpendByCombo.reduce((s, c) => s + c.actualSpend, 0);
    expect(bTotal).toBeCloseTo(777, 2);
  });

  it("actual revenue == the store's month sum (SAR), orders counted", async () => {
    await db.insert(users).values({
      id: UPLOADER,
      email: "budget-uploader@test.local",
      name: "Uploader",
      role: "editor",
    });
    await writeStoreBatch({
      accountId: ACCOUNT_A,
      fileName: "jan.csv",
      uploadedByUserId: UPLOADER,
      upsert: false,
      inserts: [
        { orderId: "J1", orderDate: "2026-01-05", totalAmount: "150.00", attributes: {} },
        { orderId: "J2", orderDate: "2026-01-20", totalAmount: "250.50", attributes: {} },
        // Outside the month — must not count.
        { orderId: "F1", orderDate: "2026-02-01", totalAmount: "999.00", attributes: {} },
      ],
      updates: [],
    });
    const data = await getBudgetMonth(MONTH);
    expect(data.actualRevenueSar).toBeCloseTo(400.5, 2);
    expect(data.actualOrders).toBe(2);
  });
});
