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
  budgetDailySeries,
  budgetHistory,
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

describe("budget v2 — day weights, reserve, daily series, history", () => {
  it("day-weight CRUD: only non-1 overrides persist; weight→1 deletes; unique per day", async () => {
    await replaceBudgetMonth(db, ACCOUNT_A, MONTH, {
      allocations: [],
      plannedRevenueSar: null,
      reserveSpendUsd: 0,
      dayWeights: { 27: 3, 15: 2, 10: 1 }, // 10 is weight 1 → not stored
    });
    let data = await getBudgetMonth(MONTH);
    expect(data.dayWeightOverrides).toEqual({ 15: 2, 27: 3 });

    // Re-save with day 27 back at 1 → its row is gone (absent = 1).
    await replaceBudgetMonth(db, ACCOUNT_A, MONTH, {
      allocations: [],
      plannedRevenueSar: null,
      dayWeights: { 15: 2, 27: 1 },
    });
    data = await getBudgetMonth(MONTH);
    expect(data.dayWeightOverrides).toEqual({ 15: 2 });

    // (account, month, day) is unique — a direct duplicate insert refuses.
    await expect(
      db.transaction(async (tx) => {
        const { budgetDayWeights } = await import("@/db/schema");
        await tx.insert(budgetDayWeights).values([
          { accountId: ACCOUNT_A, month: "2026-01-01", day: 15, weight: "4.00" },
        ]);
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("reserve persists — including a reserve-only month (no revenue target)", async () => {
    await replaceBudgetMonth(db, ACCOUNT_A, MONTH, {
      allocations: [],
      plannedRevenueSar: null,
      reserveSpendUsd: 2000,
    });
    const data = await getBudgetMonth(MONTH);
    expect(data.reserveSpendUsd).toBeCloseTo(2000, 2);
    expect(data.plannedRevenueSar).toBeNull(); // stored 0 reads as "no target"
  });

  it("per-day spend equals raw per-day totals — EXCLUDED RECORDS INCLUDED", async () => {
    const daily = await budgetDailySeries(MONTH);
    expect(daily).toHaveLength(31);
    const byDay = new Map(daily.map((d) => [d.day, d.spend]));
    expect(byDay.get(1)).toBeCloseTo(300, 2); // 100 IG + 200 FB
    expect(byDay.get(2)).toBeCloseTo(100, 2);
    expect(byDay.get(3)).toBeCloseTo(1000, 2); // the excluded row IS counted
    expect(byDay.get(4)).toBeCloseTo(0, 2); // genuine zero day
    const sum = daily.reduce((s, d) => s + d.spend, 0);
    expect(sum).toBeCloseTo(await rawMonthSpendTotal(MONTH), 2);
  });

  it("per-day revenue/orders equal the store's per-day sums", async () => {
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
        { orderId: "J2", orderDate: "2026-01-05", totalAmount: "50.00", attributes: {} },
        { orderId: "J3", orderDate: "2026-01-20", totalAmount: "250.50", attributes: {} },
        { orderId: "F1", orderDate: "2026-02-01", totalAmount: "999.00", attributes: {} },
      ],
      updates: [],
    });
    const daily = await budgetDailySeries(MONTH);
    const d5 = daily.find((d) => d.day === 5)!;
    const d20 = daily.find((d) => d.day === 20)!;
    expect(d5.revenueSar).toBeCloseTo(200, 2);
    expect(d5.orders).toBe(2);
    expect(d20.revenueSar).toBeCloseTo(250.5, 2);
    expect(d20.orders).toBe(1);
    // The February order never leaks into January's series.
    const total = daily.reduce((s, d) => s + d.revenueSar, 0);
    expect(total).toBeCloseTo(450.5, 2);
  });

  it("copy-last-month carries weights (day 31 dropped for shorter months) + reserve", async () => {
    await replaceBudgetMonth(db, ACCOUNT_A, "2026-01", {
      allocations: [{ platform: "instagram", objective: "Sales", plannedSpend: 1000 }],
      plannedRevenueSar: 25000,
      reserveSpendUsd: 1500,
      dayWeights: { 15: 2, 31: 3 },
    });
    await copyBudgetMonth(db, ACCOUNT_A, "2026-01", "2026-02");
    const feb = await getBudgetMonth("2026-02"); // 28 days → day 31 dropped
    expect(feb.reserveSpendUsd).toBeCloseTo(1500, 2);
    expect(feb.dayWeightOverrides).toEqual({ 15: 2 });
    expect(feb.plannedRevenueSar).toBeCloseTo(25000, 2);
  });

  it("weights, reserve, daily series, and history are account-scoped", async () => {
    await replaceBudgetMonth(db, ACCOUNT_A, MONTH, {
      allocations: [{ platform: "instagram", objective: "Sales", plannedSpend: 1000 }],
      plannedRevenueSar: 9000,
      reserveSpendUsd: 500,
      dayWeights: { 27: 3 },
    });
    setAccount(ACCOUNT_B);
    const b = await getBudgetMonth(MONTH);
    expect(b.dayWeightOverrides).toEqual({});
    expect(b.reserveSpendUsd).toBe(0);

    const bDaily = await budgetDailySeries(MONTH);
    expect(bDaily.reduce((s, d) => s + d.spend, 0)).toBeCloseTo(777, 2); // B's own row only

    const bHistory = await budgetHistory();
    const bJan = bHistory.find((r) => r.month === "2026-01");
    expect(bJan?.plannedSpend ?? 0).toBe(0); // A's plan is invisible to B
    expect(bJan?.actualSpend).toBeCloseTo(777, 2);
  });

  it("history merges plan + actuals per month, newest first", async () => {
    await replaceBudgetMonth(db, ACCOUNT_A, "2026-01", {
      allocations: [{ platform: "instagram", objective: "Sales", plannedSpend: 1200 }],
      plannedRevenueSar: 30000,
      reserveSpendUsd: 300,
    });
    await replaceBudgetMonth(db, ACCOUNT_A, "2026-02", {
      allocations: [{ platform: "facebook", objective: "Awareness", plannedSpend: 400 }],
      plannedRevenueSar: null,
    });
    const rows = await budgetHistory();
    expect(rows.map((r) => r.month)).toEqual(["2026-02", "2026-01"]);
    const jan = rows[1]!;
    expect(jan.plannedSpend).toBeCloseTo(1200, 2);
    expect(jan.reserveSpendUsd).toBeCloseTo(300, 2);
    expect(jan.actualSpend).toBeCloseTo(1400, 2); // raw, excluded included
    expect(jan.plannedRevenueSar).toBeCloseTo(30000, 2);
    const feb = rows[0]!;
    expect(feb.plannedRevenueSar).toBeNull();
  });
});
