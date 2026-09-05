import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts,
  budgetAllocations,
  budgetDayWeights,
  budgetTargets,
  campaigns,
  performanceRecords,
  storeOrders,
} from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import {
  mapWeightsToMonth,
  monthStartIso,
  nextMonthKey,
  prevMonthKey,
  validateWeight,
} from "@/lib/budget";

/**
 * Budget module queries — monthly plan vs actual. STANDING DECISION: actuals
 * here are RAW totals with **no exclusion filtering** — `excluded_from_
 * aggregates` is deliberately ignored in this module (budget answers "what did
 * we actually spend", not "what counts for performance analysis"), so budget
 * actuals can differ slightly from dashboard aggregates. Do not "fix" this.
 * Account-scoped (§4.1). Spend USD; revenue SAR (store facts).
 */

type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface BudgetAllocationRow {
  id: string;
  platform: string;
  objective: string;
  plannedSpend: number;
}

export interface BudgetActualCombo {
  platform: string;
  objective: string;
  actualSpend: number;
}

export interface BudgetMonthData {
  monthIso: string;
  allocations: BudgetAllocationRow[];
  plannedRevenueSar: number | null;
  /** Contingency USD on top of the plan — OUTSIDE the curve (see schema). */
  reserveSpendUsd: number;
  /** Day-weight overrides (only non-1 days are stored; absent = 1). */
  dayWeightOverrides: Record<number, number>;
  actualSpendByCombo: BudgetActualCombo[];
  actualRevenueSar: number;
  actualOrders: number;
  usdToSarRate: number;
  /** Whether the PREVIOUS month has any plan (drives "Copy from last month"). */
  prevMonthHasPlan: boolean;
}

/** [start, end) date bounds for a month key/ISO. */
function monthBounds(month: string): { start: string; end: string } {
  const start = monthStartIso(month);
  return { start, end: monthStartIso(nextMonthKey(month.slice(0, 7))) };
}

export async function getBudgetMonth(month: string): Promise<BudgetMonthData> {
  const acct = await getActiveAccountId();
  const { start, end } = monthBounds(month);
  const prevStart = monthStartIso(prevMonthKey(month.slice(0, 7)));

  const [allocations, targetRows, weightRows, spendRows, revenueRow, rateRow, prevAlloc, prevTarget] =
    await Promise.all([
      db
        .select({
          id: budgetAllocations.id,
          platform: budgetAllocations.platform,
          objective: budgetAllocations.objective,
          plannedSpend: budgetAllocations.plannedSpend,
        })
        .from(budgetAllocations)
        .where(and(eq(budgetAllocations.accountId, acct), eq(budgetAllocations.month, start)))
        .orderBy(asc(budgetAllocations.platform), asc(budgetAllocations.objective)),
      db
        .select({
          planned: budgetTargets.plannedRevenueSar,
          reserve: budgetTargets.reserveSpendUsd,
        })
        .from(budgetTargets)
        .where(and(eq(budgetTargets.accountId, acct), eq(budgetTargets.month, start)))
        .limit(1),
      db
        .select({ day: budgetDayWeights.day, weight: budgetDayWeights.weight })
        .from(budgetDayWeights)
        .where(and(eq(budgetDayWeights.accountId, acct), eq(budgetDayWeights.month, start))),
      // Actual spend by platform × objective. RAW — no excluded filter, on purpose.
      db
        .select({
          platform: performanceRecords.platform,
          objective: campaigns.objective,
          actualSpend: sql<string>`COALESCE(SUM(${performanceRecords.spend}), 0)`,
        })
        .from(performanceRecords)
        .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
        .where(
          and(
            eq(performanceRecords.accountId, acct),
            gte(performanceRecords.date, start),
            lt(performanceRecords.date, end),
          ),
        )
        .groupBy(performanceRecords.platform, campaigns.objective),
      db
        .select({
          revenue: sql<string>`COALESCE(SUM(${storeOrders.totalAmount}), 0)`,
          orders: sql<number>`count(*)::int`,
        })
        .from(storeOrders)
        .where(
          and(
            eq(storeOrders.accountId, acct),
            gte(storeOrders.orderDate, start),
            lt(storeOrders.orderDate, end),
          ),
        ),
      db
        .select({ rate: accounts.usdToSarRate })
        .from(accounts)
        .where(eq(accounts.id, acct))
        .limit(1),
      db
        .select({ id: budgetAllocations.id })
        .from(budgetAllocations)
        .where(and(eq(budgetAllocations.accountId, acct), eq(budgetAllocations.month, prevStart)))
        .limit(1),
      db
        .select({ id: budgetTargets.id })
        .from(budgetTargets)
        .where(and(eq(budgetTargets.accountId, acct), eq(budgetTargets.month, prevStart)))
        .limit(1),
    ]);

  return {
    monthIso: start,
    allocations: allocations.map((a) => ({
      id: a.id,
      platform: a.platform,
      objective: a.objective,
      plannedSpend: Number(a.plannedSpend),
    })),
    // A zero stored revenue target reads as "no target" (rows can exist for
    // the reserve alone, since planned_revenue_sar is NOT NULL).
    plannedRevenueSar:
      targetRows[0] && Number(targetRows[0].planned) > 0
        ? Number(targetRows[0].planned)
        : null,
    reserveSpendUsd: targetRows[0] ? Number(targetRows[0].reserve) : 0,
    dayWeightOverrides: Object.fromEntries(
      weightRows.map((w) => [w.day, Number(w.weight)]),
    ),
    actualSpendByCombo: spendRows.map((r) => ({
      platform: r.platform,
      objective: r.objective,
      actualSpend: Number(r.actualSpend),
    })),
    actualRevenueSar: Number(revenueRow[0]?.revenue ?? 0),
    actualOrders: Number(revenueRow[0]?.orders ?? 0),
    usdToSarRate: Number(rateRow[0]?.rate ?? 3.77),
    prevMonthHasPlan: prevAlloc.length > 0 || prevTarget.length > 0,
  };
}

/**
 * The month's RAW spend total straight off performance_records (no joins, no
 * exclusion filter) — the invariant the spend table must reconcile to exactly.
 */
export async function rawMonthSpendTotal(month: string): Promise<number> {
  const acct = await getActiveAccountId();
  const { start, end } = monthBounds(month);
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${performanceRecords.spend}), 0)` })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        gte(performanceRecords.date, start),
        lt(performanceRecords.date, end),
      ),
    );
  return Number(row?.total ?? 0);
}

export interface BudgetPlanInput {
  allocations: Array<{ platform: string; objective: string; plannedSpend: number }>;
  plannedRevenueSar: number | null;
  /** Contingency USD (0 = none). */
  reserveSpendUsd?: number;
  /** Day-weight overrides; only non-1 valid weights are persisted. */
  dayWeights?: Record<number, number>;
}

/**
 * Replace a month's whole plan (allocations + revenue target) transactionally.
 * Full-replace semantics keeps the save path identical to the editor's draft
 * (what you see is exactly what's stored afterward).
 */
export async function replaceBudgetMonth(
  exec: Exec,
  acct: string,
  month: string,
  plan: BudgetPlanInput,
): Promise<void> {
  const start = monthStartIso(month);
  await exec
    .delete(budgetAllocations)
    .where(and(eq(budgetAllocations.accountId, acct), eq(budgetAllocations.month, start)));
  if (plan.allocations.length > 0) {
    await exec.insert(budgetAllocations).values(
      plan.allocations.map((a) => ({
        accountId: acct,
        month: start,
        platform: a.platform as (typeof budgetAllocations.$inferInsert)["platform"],
        objective: a.objective as (typeof budgetAllocations.$inferInsert)["objective"],
        plannedSpend: a.plannedSpend.toFixed(2),
      })),
    );
  }
  await exec
    .delete(budgetTargets)
    .where(and(eq(budgetTargets.accountId, acct), eq(budgetTargets.month, start)));
  const reserve = plan.reserveSpendUsd ?? 0;
  if (plan.plannedRevenueSar !== null || reserve > 0) {
    await exec.insert(budgetTargets).values({
      accountId: acct,
      month: start,
      plannedRevenueSar: (plan.plannedRevenueSar ?? 0).toFixed(2),
      reserveSpendUsd: reserve.toFixed(2),
    });
  }
  await exec
    .delete(budgetDayWeights)
    .where(and(eq(budgetDayWeights.accountId, acct), eq(budgetDayWeights.month, start)));
  const weightEntries = Object.entries(plan.dayWeights ?? {})
    .map(([d, w]) => ({ day: Number(d), weight: w }))
    .filter((e) => e.day >= 1 && e.day <= 31 && e.weight !== 1 && validateWeight(e.weight));
  if (weightEntries.length > 0) {
    await exec.insert(budgetDayWeights).values(
      weightEntries.map((e) => ({
        accountId: acct,
        month: start,
        day: e.day,
        weight: e.weight.toFixed(2),
      })),
    );
  }
}

/**
 * Copy a month's plan onto another month (both first-of-month ISO), replacing
 * whatever the destination had. Returns what was copied.
 */
export async function copyBudgetMonth(
  exec: Exec,
  acct: string,
  fromMonth: string,
  toMonth: string,
): Promise<{ allocations: number; hasTarget: boolean }> {
  const from = monthStartIso(fromMonth);
  const src = await exec
    .select({
      platform: budgetAllocations.platform,
      objective: budgetAllocations.objective,
      plannedSpend: budgetAllocations.plannedSpend,
    })
    .from(budgetAllocations)
    .where(and(eq(budgetAllocations.accountId, acct), eq(budgetAllocations.month, from)));
  const srcTarget = await exec
    .select({
      planned: budgetTargets.plannedRevenueSar,
      reserve: budgetTargets.reserveSpendUsd,
    })
    .from(budgetTargets)
    .where(and(eq(budgetTargets.accountId, acct), eq(budgetTargets.month, from)))
    .limit(1);
  const srcWeights = await exec
    .select({ day: budgetDayWeights.day, weight: budgetDayWeights.weight })
    .from(budgetDayWeights)
    .where(and(eq(budgetDayWeights.accountId, acct), eq(budgetDayWeights.month, from)));

  await replaceBudgetMonth(exec, acct, toMonth, {
    allocations: src.map((a) => ({
      platform: a.platform,
      objective: a.objective,
      plannedSpend: Number(a.plannedSpend),
    })),
    plannedRevenueSar:
      srcTarget[0] && Number(srcTarget[0].planned) > 0 ? Number(srcTarget[0].planned) : null,
    reserveSpendUsd: srcTarget[0] ? Number(srcTarget[0].reserve) : 0,
    // Day numbers carry over; day 31 → dropped for shorter target months.
    dayWeights: mapWeightsToMonth(
      Object.fromEntries(srcWeights.map((w) => [w.day, Number(w.weight)])),
      toMonth,
    ),
  });
  return { allocations: src.length, hasTarget: srcTarget.length > 0 };
}

// ── Daily + History (v2) ─────────────────────────────────────────────────────

/** The active brand's USD→SAR rate (History needs just this, not a full month). */
export async function getUsdToSarRate(): Promise<number> {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({ rate: accounts.usdToSarRate })
    .from(accounts)
    .where(eq(accounts.id, acct))
    .limit(1);
  return Number(row?.rate ?? 3.77);
}

export interface BudgetDailyRow {
  day: number;
  date: string;
  spend: number;
  revenueSar: number;
  orders: number;
}

/**
 * Per-day spend + store revenue/orders for the month. RAW spend (no exclusion
 * filter — the module's standing decision). Days with no rows come back as 0;
 * the UI decides how to render days past the data horizon.
 */
export async function budgetDailySeries(month: string): Promise<BudgetDailyRow[]> {
  const acct = await getActiveAccountId();
  const { start, end } = monthBounds(month);
  const [spendRows, revRows] = await Promise.all([
    db
      .select({
        date: performanceRecords.date,
        spend: sql<string>`COALESCE(SUM(${performanceRecords.spend}), 0)`,
      })
      .from(performanceRecords)
      .where(
        and(
          eq(performanceRecords.accountId, acct),
          gte(performanceRecords.date, start),
          lt(performanceRecords.date, end),
        ),
      )
      .groupBy(performanceRecords.date),
    db
      .select({
        date: storeOrders.orderDate,
        revenue: sql<string>`COALESCE(SUM(${storeOrders.totalAmount}), 0)`,
        orders: sql<number>`count(*)::int`,
      })
      .from(storeOrders)
      .where(
        and(
          eq(storeOrders.accountId, acct),
          gte(storeOrders.orderDate, start),
          lt(storeOrders.orderDate, end),
        ),
      )
      .groupBy(storeOrders.orderDate),
  ]);

  const spendByDate = new Map(spendRows.map((r) => [r.date, Number(r.spend)]));
  const revByDate = new Map(
    revRows.map((r) => [r.date, { revenue: Number(r.revenue), orders: Number(r.orders) }]),
  );
  const days = new Date(
    Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0),
  ).getUTCDate();
  return Array.from({ length: days }, (_, i) => {
    const date = `${start.slice(0, 8)}${String(i + 1).padStart(2, "0")}`;
    const rev = revByDate.get(date);
    return {
      day: i + 1,
      date,
      spend: spendByDate.get(date) ?? 0,
      revenueSar: rev?.revenue ?? 0,
      orders: rev?.orders ?? 0,
    };
  });
}

export interface BudgetHistoryRow {
  month: string; // YYYY-MM
  plannedSpend: number;
  reserveSpendUsd: number;
  actualSpend: number;
  plannedRevenueSar: number | null;
  actualRevenueSar: number;
}

/**
 * One row per month that has a plan OR actuals, newest first. Bounded
 * month-grain scans (a handful of GROUP BYs); RAW spend as everywhere here.
 */
export async function budgetHistory(): Promise<BudgetHistoryRow[]> {
  const acct = await getActiveAccountId();
  const [planRows, targetRows, spendRows, revRows] = await Promise.all([
    db
      .select({
        month: budgetAllocations.month,
        planned: sql<string>`COALESCE(SUM(${budgetAllocations.plannedSpend}), 0)`,
      })
      .from(budgetAllocations)
      .where(eq(budgetAllocations.accountId, acct))
      .groupBy(budgetAllocations.month),
    db
      .select({
        month: budgetTargets.month,
        planned: budgetTargets.plannedRevenueSar,
        reserve: budgetTargets.reserveSpendUsd,
      })
      .from(budgetTargets)
      .where(eq(budgetTargets.accountId, acct)),
    db
      .select({
        month: sql<string>`(date_trunc('month', ${performanceRecords.date}))::date`,
        spend: sql<string>`COALESCE(SUM(${performanceRecords.spend}), 0)`,
      })
      .from(performanceRecords)
      .where(eq(performanceRecords.accountId, acct))
      .groupBy(sql`1`),
    db
      .select({
        month: sql<string>`(date_trunc('month', ${storeOrders.orderDate}))::date`,
        revenue: sql<string>`COALESCE(SUM(${storeOrders.totalAmount}), 0)`,
      })
      .from(storeOrders)
      .where(eq(storeOrders.accountId, acct))
      .groupBy(sql`1`),
  ]);

  const byMonth = new Map<string, BudgetHistoryRow>();
  const ensure = (monthIso: string): BudgetHistoryRow => {
    const key = monthIso.slice(0, 7);
    let row = byMonth.get(key);
    if (!row) {
      row = {
        month: key,
        plannedSpend: 0,
        reserveSpendUsd: 0,
        actualSpend: 0,
        plannedRevenueSar: null,
        actualRevenueSar: 0,
      };
      byMonth.set(key, row);
    }
    return row;
  };
  for (const r of planRows) ensure(r.month).plannedSpend = Number(r.planned);
  for (const r of targetRows) {
    const row = ensure(r.month);
    row.plannedRevenueSar = Number(r.planned) > 0 ? Number(r.planned) : null;
    row.reserveSpendUsd = Number(r.reserve);
  }
  for (const r of spendRows) ensure(r.month).actualSpend = Number(r.spend);
  for (const r of revRows) ensure(r.month).actualRevenueSar = Number(r.revenue);
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}
