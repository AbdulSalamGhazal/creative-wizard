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
  budgetPacingSeries,
  budgetPlansForMonths,
} from "@/db/queries/budget";
import { writeStoreBatch } from "@/db/queries/store";
import { resetAndSeed } from "./fixtures";

const UPLOADER = "dddddddd-0000-0000-0000-0000000000f1";
const MONTH = "2026-01"; // the fixtures' perf month (incl. one EXCLUDED row)
const M_START = "2026-01-01";
const M_END = "2026-01-31";
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
      allocations: [{ platform: "instagram", objective: "Other", plannedSpend: 1500 }],
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
        { platform: "instagram", objective: "Other", plannedSpend: 1000 },
        { platform: "facebook", objective: "Awareness", plannedSpend: 500 },
      ],
      plannedRevenueSar: 25000,
    });
    const copied = await copyBudgetMonth(db, ACCOUNT_A, "2026-01", "2026-02");
    expect(copied.allocations).toBe(2);
    expect(copied.hasTarget).toBe(true);
    // The applied plan comes back so the caller can snapshot it in the same
    // transaction as the write (see insertPlanRevision).
    expect(copied.plan.allocations).toHaveLength(2);
    expect(copied.plan.plannedRevenueSar).toBe(25000);

    const feb = await getBudgetMonth("2026-02");
    expect(feb.allocations).toHaveLength(2);
    expect(feb.plannedRevenueSar).toBeCloseTo(25000, 2);

    // Copying from an EMPTY month wipes the destination (replace semantics).
    const empty = await copyBudgetMonth(db, ACCOUNT_A, "2025-12", "2026-02");
    expect(empty.allocations).toBe(0);
    expect(empty.hasTarget).toBe(false);
    expect((await getBudgetMonth("2026-02")).allocations).toHaveLength(0);
  });

  it("unique (account, month, platform, objective) refuses duplicate combos", async () => {
    await replaceBudgetMonth(db, ACCOUNT_A, MONTH, {
      allocations: [{ platform: "tiktok", objective: "Other", plannedSpend: 100 }],
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
          objective: "Other",
          plannedSpend: "999.00",
        });
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("is account-scoped — B sees neither A's plan nor A's actuals", async () => {
    await replaceBudgetMonth(db, ACCOUNT_A, MONTH, {
      allocations: [{ platform: "instagram", objective: "Other", plannedSpend: 1000 }],
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
    const { spend, days } = await budgetPacingSeries(M_START, M_END);
    expect(days).toHaveLength(31);
    // The UI folds the sparse spend rows onto the dense day list; do the same.
    const byDay = new Map<number, number>();
    for (const r of spend) {
      const day = Number(r.date.slice(8, 10));
      byDay.set(day, (byDay.get(day) ?? 0) + r.spend);
    }
    expect(byDay.get(1)).toBeCloseTo(300, 2); // 100 IG + 200 FB
    expect(byDay.get(2)).toBeCloseTo(100, 2);
    expect(byDay.get(3)).toBeCloseTo(1000, 2); // the excluded row IS counted
    expect(byDay.get(4) ?? 0).toBeCloseTo(0, 2); // genuine zero day — no row at all
    const sum = spend.reduce((s, r) => s + r.spend, 0);
    expect(sum).toBeCloseTo(await rawMonthSpendTotal(MONTH), 2);
  });

  it("campaign objectives are folded onto Budget's buckets before they leave the query", async () => {
    // Every fixture campaign is "Sales" — a campaign objective with no budget
    // bucket of its own, so Budget sees it as "Other".
    const data = await getBudgetMonth(MONTH);
    expect(data.actualSpendByCombo.every((c) => c.objective === "Other")).toBe(true);
    // …and the fold does not lose or duplicate money.
    const comboTotal = data.actualSpendByCombo.reduce((s, c) => s + c.actualSpend, 0);
    expect(comboTotal).toBeCloseTo(await rawMonthSpendTotal(MONTH), 2);

    const { spend } = await budgetPacingSeries(M_START, M_END);
    expect(spend.every((r) => r.objective === "Other")).toBe(true);
    expect(spend.reduce((s, r) => s + r.spend, 0)).toBeCloseTo(comboTotal, 2);
  });

  it("spend rows carry the platform and the campaign's CURRENT objective", async () => {
    const { spend } = await budgetPacingSeries(M_START, M_END);
    // Every row is a real (date, platform, objective) combo — no zero padding.
    expect(spend.every((r) => r.spend > 0)).toBe(true);
    expect(new Set(spend.map((r) => r.platform))).toEqual(
      new Set(["instagram", "facebook"]),
    );
    expect(spend.every((r) => typeof r.objective === "string" && r.objective.length > 0)).toBe(
      true,
    );

    // Per platform × objective, the sums reconcile to the raw month total —
    // the same invariant the allocation-check table renders.
    const byCombo = new Map<string, number>();
    for (const r of spend) {
      const key = `${r.platform}|${r.objective}`;
      byCombo.set(key, (byCombo.get(key) ?? 0) + r.spend);
    }
    const comboTotal = [...byCombo.values()].reduce((s, v) => s + v, 0);
    expect(comboTotal).toBeCloseTo(await rawMonthSpendTotal(MONTH), 2);

    // …and they agree, combo for combo, with the month view's own breakdown.
    const overview = await getBudgetMonth(MONTH);
    for (const c of overview.actualSpendByCombo) {
      expect(byCombo.get(`${c.platform}|${c.objective}`) ?? 0).toBeCloseTo(c.actualSpend, 2);
    }
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
    const { days: daily } = await budgetPacingSeries(M_START, M_END);
    const d5 = daily.find((d) => d.date === "2026-01-05")!;
    const d20 = daily.find((d) => d.date === "2026-01-20")!;
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
      allocations: [{ platform: "instagram", objective: "Other", plannedSpend: 1000 }],
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

  it("weights, reserve, pacing series, and plans are account-scoped", async () => {
    await replaceBudgetMonth(db, ACCOUNT_A, MONTH, {
      allocations: [{ platform: "instagram", objective: "Other", plannedSpend: 1000 }],
      plannedRevenueSar: 9000,
      reserveSpendUsd: 500,
      dayWeights: { 27: 3 },
    });
    setAccount(ACCOUNT_B);
    const b = await getBudgetMonth(MONTH);
    expect(b.dayWeightOverrides).toEqual({});
    expect(b.reserveSpendUsd).toBe(0);

    const bSeries = await budgetPacingSeries(M_START, M_END);
    expect(bSeries.spend.reduce((s, r) => s + r.spend, 0)).toBeCloseTo(777, 2); // B's row only

    const bPlans = await budgetPlansForMonths([MONTH]);
    expect(bPlans[0]!.allocations).toHaveLength(0); // A's plan is invisible to B
    expect(bPlans[0]!.plannedRevenueSar).toBeNull();
  });

  it("budgetPlansForMonths returns one entry per requested month, in order", async () => {
    await replaceBudgetMonth(db, ACCOUNT_A, "2026-01", {
      allocations: [
        { platform: "instagram", objective: "Awareness", plannedSpend: 1200 },
        { platform: "facebook", objective: "Other", plannedSpend: 300 },
      ],
      plannedRevenueSar: 30000,
      reserveSpendUsd: 300,
      dayWeights: { 15: 2 },
    });

    // Three months asked for, only one planned — the other two come back empty
    // rather than missing, so the caller can tell "no plan" from "not fetched".
    const plans = await budgetPlansForMonths(["2025-12", "2026-01", "2026-02"]);
    expect(plans.map((p) => p.month)).toEqual(["2025-12", "2026-01", "2026-02"]);

    const jan = plans.find((p) => p.month === "2026-01")!;
    expect(jan.allocations).toHaveLength(2);
    expect(jan.allocations.reduce((s, a) => s + a.plannedSpend, 0)).toBeCloseTo(1500, 2);
    expect(jan.plannedRevenueSar).toBeCloseTo(30000, 2);
    expect(jan.reserveSpendUsd).toBeCloseTo(300, 2);
    expect(jan.dayWeights).toEqual({ 15: 2 });

    const dec = plans.find((p) => p.month === "2025-12")!;
    expect(dec.allocations).toEqual([]);
    expect(dec.plannedRevenueSar).toBeNull();
    expect(dec.dayWeights).toEqual({});
  });
});

/**
 * Ads and store data are uploaded separately, so Budget Daily gates each side
 * by its OWN horizon. Before this, one shared ads horizon blanked out real
 * revenue for a brand that had orders but no ad exports yet.
 */
describe("budget daily — per-metric data horizons", () => {
  it("store horizon is independent of the ads horizon and account-scoped", async () => {
    const { dataHorizon, storeDataHorizon } = await import("@/db/queries/series-bounds");
    await db.insert(users).values({
      id: UPLOADER,
      email: "horizon-uploader@test.local",
      name: "Uploader",
      role: "editor",
    });
    await writeStoreBatch({
      accountId: ACCOUNT_A,
      fileName: "later.csv",
      uploadedByUserId: UPLOADER,
      upsert: false,
      // Deliberately LATER than the fixtures' newest performance record.
      inserts: [{ orderId: "H1", orderDate: "2026-05-20", totalAmount: "300.00", attributes: {} }],
      updates: [],
    });

    const ads = await dataHorizon();
    const store = await storeDataHorizon();
    expect(store).toBe("2026-05-20");
    expect(ads).not.toBe(store); // genuinely different freshness
    // Account B has no orders at all → null, not A's date.
    setAccount(ACCOUNT_B);
    expect(await storeDataHorizon()).toBeNull();
  });

  it("Daily's month revenue total equals the Overview tile for the same month", async () => {
    await db.insert(users).values({
      id: UPLOADER,
      email: "horizon-uploader@test.local",
      name: "Uploader",
      role: "editor",
    });
    await writeStoreBatch({
      accountId: ACCOUNT_A,
      fileName: "jan.csv",
      uploadedByUserId: UPLOADER,
      upsert: false,
      inserts: [
        { orderId: "T1", orderDate: "2026-01-05", totalAmount: "150.00", attributes: {} },
        { orderId: "T2", orderDate: "2026-01-20", totalAmount: "250.50", attributes: {} },
      ],
      updates: [],
    });

    const { storeDataHorizon } = await import("@/db/queries/series-bounds");
    const { days: daily } = await budgetPacingSeries(M_START, M_END);
    const overview = await getBudgetMonth(MONTH);
    const storeHorizon = await storeDataHorizon();

    // Sum the days Pacing would treat as KNOWN for revenue — i.e. gated by the
    // STORE horizon, not the ads one.
    const dailyRevenue = daily
      .filter((d) => d.date <= storeHorizon!)
      .reduce((s, d) => s + d.revenueSar, 0);
    expect(dailyRevenue).toBeCloseTo(overview.actualRevenueSar, 2);
    expect(dailyRevenue).toBeCloseTo(400.5, 2);
  });
});
