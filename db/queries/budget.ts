import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts,
  budgetAllocations,
  budgetTargets,
  campaigns,
  performanceRecords,
  storeOrders,
} from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import { monthStartIso, nextMonthKey, prevMonthKey } from "@/lib/budget";

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

  const [allocations, targetRows, spendRows, revenueRow, rateRow, prevAlloc, prevTarget] =
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
        .select({ planned: budgetTargets.plannedRevenueSar })
        .from(budgetTargets)
        .where(and(eq(budgetTargets.accountId, acct), eq(budgetTargets.month, start)))
        .limit(1),
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
    plannedRevenueSar: targetRows[0] ? Number(targetRows[0].planned) : null,
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
  if (plan.plannedRevenueSar !== null) {
    await exec.insert(budgetTargets).values({
      accountId: acct,
      month: start,
      plannedRevenueSar: plan.plannedRevenueSar.toFixed(2),
    });
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
    .select({ planned: budgetTargets.plannedRevenueSar })
    .from(budgetTargets)
    .where(and(eq(budgetTargets.accountId, acct), eq(budgetTargets.month, from)))
    .limit(1);

  await replaceBudgetMonth(exec, acct, toMonth, {
    allocations: src.map((a) => ({
      platform: a.platform,
      objective: a.objective,
      plannedSpend: Number(a.plannedSpend),
    })),
    plannedRevenueSar: srcTarget[0] ? Number(srcTarget[0].planned) : null,
  });
  return { allocations: src.length, hasTarget: srcTarget.length > 0 };
}
