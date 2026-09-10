import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts,
  budgetAllocations,
  budgetDayWeights,
  budgetPlanRevisions,
  budgetTargets,
  campaigns,
  performanceRecords,
  storeOrders,
  users,
} from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import {
  storedSnapshotSchema,
  type BudgetPlanSnapshot,
} from "@/validators/budget";
import {
  budgetComboKey,
  isoPlusDays,
  mapWeightsToMonth,
  monthStartIso,
  nextMonthKey,
  toBudgetObjective,
  validateWeight,
  type BudgetObjective,
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
  /** Budget's own bucket, not the campaign's raw objective. */
  objective: BudgetObjective;
  actualSpend: number;
}

export interface BudgetMonthData {
  monthIso: string;
  allocations: BudgetAllocationRow[];
  plannedRevenueSar: number | null;
  /** The reserve (USD) — part of the total, not yet allocated; outside the curve. */
  reserveSpendUsd: number;
  /** Day-weight overrides (only non-1 days are stored; absent = 1). */
  dayWeightOverrides: Record<number, number>;
  actualSpendByCombo: BudgetActualCombo[];
  actualRevenueSar: number;
  actualOrders: number;
  usdToSarRate: number;
}

/** Fold raw (platform, campaign objective) spend rows onto Budget's buckets. */
function bucketCombos(
  rows: Array<{ platform: string; objective: string; actualSpend: string | number }>,
): BudgetActualCombo[] {
  const merged = new Map<string, BudgetActualCombo>();
  for (const r of rows) {
    const objective = toBudgetObjective(r.objective);
    const key = budgetComboKey(r.platform, objective);
    const existing = merged.get(key);
    if (existing) existing.actualSpend += Number(r.actualSpend);
    else merged.set(key, { platform: r.platform, objective, actualSpend: Number(r.actualSpend) });
  }
  return [...merged.values()];
}

/** [start, end) date bounds for a month key/ISO. */
function monthBounds(month: string): { start: string; end: string } {
  const start = monthStartIso(month);
  return { start, end: monthStartIso(nextMonthKey(month.slice(0, 7))) };
}

export async function getBudgetMonth(month: string): Promise<BudgetMonthData> {
  const acct = await getActiveAccountId();
  const { start, end } = monthBounds(month);

  const [allocations, targetRows, weightRows, spendRows, revenueRow, rateRow] =
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
    // Campaign objectives are folded onto Budget's buckets HERE, so no
    // consumer has to remember to do it — and two campaign objectives that map
    // to the same bucket merge into one row rather than double-listing.
    actualSpendByCombo: bucketCombos(spendRows),
    actualRevenueSar: Number(revenueRow[0]?.revenue ?? 0),
    actualOrders: Number(revenueRow[0]?.orders ?? 0),
    usdToSarRate: Number(rateRow[0]?.rate ?? 3.77),
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
  /** The reserve (USD), carved out of the total (0 = none). */
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
): Promise<{ allocations: number; hasTarget: boolean; plan: BudgetPlanInput }> {
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

  const plan: BudgetPlanInput = {
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
  };
  await replaceBudgetMonth(exec, acct, toMonth, plan);
  return { allocations: src.length, hasTarget: srcTarget.length > 0, plan };
}

// ── Pacing + History (v2) ────────────────────────────────────────────────────

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

export interface BudgetPacingDaySpend {
  date: string;
  platform: string;
  /** Budget's own bucket (see `toBudgetObjective`), not the raw campaign value. */
  objective: BudgetObjective;
  spend: number;
}

export interface BudgetPacingDayTotals {
  date: string;
  revenueSar: number;
  orders: number;
}

export interface BudgetPacingSeries {
  /** One row per (date, platform, bucket) that actually spent. */
  spend: BudgetPacingDaySpend[];
  /** One row per day of the range, revenue/orders zero-filled. */
  days: BudgetPacingDayTotals[];
}

/**
 * The raw material for Pacing over an arbitrary date range: per-day spend by
 * platform × budget objective, plus per-day store revenue and order counts.
 * RAW spend (no exclusion filter — the module's standing decision).
 *
 * TWO scans for the whole range, whatever the page is showing. Every scope the
 * UI offers (totals, a platform subset, the objective breakdown) and every
 * bucket size (day, week, month) is folded from these rows in JS — `lib/db.ts`
 * runs one connection, so a query per scope would be a serial round-trip each.
 * Spend rows are sparse (only real combos); the day list is dense so the UI can
 * tell a genuine zero from a day past the horizon.
 */
export async function budgetPacingSeries(
  from: string,
  to: string,
): Promise<BudgetPacingSeries> {
  const acct = await getActiveAccountId();
  const [spendRows, revRows] = await Promise.all([
    db
      .select({
        date: performanceRecords.date,
        platform: performanceRecords.platform,
        objective: campaigns.objective,
        spend: sql<string>`COALESCE(SUM(${performanceRecords.spend}), 0)`,
      })
      .from(performanceRecords)
      .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
      .where(
        and(
          eq(performanceRecords.accountId, acct),
          gte(performanceRecords.date, from),
          lte(performanceRecords.date, to),
        ),
      )
      .groupBy(performanceRecords.date, performanceRecords.platform, campaigns.objective),
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
          gte(storeOrders.orderDate, from),
          lte(storeOrders.orderDate, to),
        ),
      )
      .groupBy(storeOrders.orderDate),
  ]);

  // Two campaign objectives can fold onto the same bucket on the same day and
  // platform — sum them rather than emitting two rows.
  const byKey = new Map<string, BudgetPacingDaySpend>();
  for (const r of spendRows) {
    const objective = toBudgetObjective(r.objective);
    const key = `${r.date}|${budgetComboKey(r.platform, objective)}`;
    const existing = byKey.get(key);
    if (existing) existing.spend += Number(r.spend);
    else
      byKey.set(key, {
        date: r.date,
        platform: r.platform,
        objective,
        spend: Number(r.spend),
      });
  }

  const revByDate = new Map(
    revRows.map((r) => [r.date, { revenue: Number(r.revenue), orders: Number(r.orders) }]),
  );
  const days: BudgetPacingDayTotals[] = [];
  for (let iso = from; iso <= to; iso = isoPlusDays(iso)) {
    const rev = revByDate.get(iso);
    days.push({ date: iso, revenueSar: rev?.revenue ?? 0, orders: rev?.orders ?? 0 });
  }

  return { spend: [...byKey.values()], days };
}

export interface MonthPlanRow {
  /** YYYY-MM */
  month: string;
  allocations: Array<{ platform: string; objective: BudgetObjective; plannedSpend: number }>;
  plannedRevenueSar: number | null;
  reserveSpendUsd: number;
  dayWeights: Record<number, number>;
}

/**
 * The plans for every month a Pacing range touches — THREE queries total, one
 * per table with an `inArray` over the months, never a round-trip per month
 * (`lib/db.ts` is `max: 1`, so those would run serially). Months with no plan
 * simply come back empty, which the caller reads as "no plan", not "zero".
 */
export async function budgetPlansForMonths(months: string[]): Promise<MonthPlanRow[]> {
  if (months.length === 0) return [];
  const acct = await getActiveAccountId();
  const starts = months.map((m) => monthStartIso(m));

  const [allocRows, targetRows, weightRows] = await Promise.all([
    db
      .select({
        month: budgetAllocations.month,
        platform: budgetAllocations.platform,
        objective: budgetAllocations.objective,
        plannedSpend: budgetAllocations.plannedSpend,
      })
      .from(budgetAllocations)
      .where(
        and(eq(budgetAllocations.accountId, acct), inArray(budgetAllocations.month, starts)),
      ),
    db
      .select({
        month: budgetTargets.month,
        planned: budgetTargets.plannedRevenueSar,
        reserve: budgetTargets.reserveSpendUsd,
      })
      .from(budgetTargets)
      .where(and(eq(budgetTargets.accountId, acct), inArray(budgetTargets.month, starts))),
    db
      .select({
        month: budgetDayWeights.month,
        day: budgetDayWeights.day,
        weight: budgetDayWeights.weight,
      })
      .from(budgetDayWeights)
      .where(
        and(eq(budgetDayWeights.accountId, acct), inArray(budgetDayWeights.month, starts)),
      ),
  ]);

  const byMonth = new Map<string, MonthPlanRow>(
    months.map((m) => [
      m,
      {
        month: m,
        allocations: [],
        plannedRevenueSar: null,
        reserveSpendUsd: 0,
        dayWeights: {},
      },
    ]),
  );
  for (const r of allocRows) {
    byMonth.get(r.month.slice(0, 7))?.allocations.push({
      platform: r.platform,
      objective: toBudgetObjective(r.objective),
      plannedSpend: Number(r.plannedSpend),
    });
  }
  for (const r of targetRows) {
    const row = byMonth.get(r.month.slice(0, 7));
    if (!row) continue;
    row.plannedRevenueSar = Number(r.planned) > 0 ? Number(r.planned) : null;
    row.reserveSpendUsd = Number(r.reserve);
  }
  for (const r of weightRows) {
    const row = byMonth.get(r.month.slice(0, 7));
    if (row) row.dayWeights[r.day] = Number(r.weight);
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

// ── Plan revisions + month list (2026-09) ────────────────────────────────────

/**
 * Every month the brand has ever planned — allocations OR a target row (a
 * month can carry only a reserve or a revenue target). Newest first; two cheap
 * month-grain GROUP BYs merged in JS.
 */
export async function plannedMonths(): Promise<string[]> {
  const acct = await getActiveAccountId();
  const [allocMonths, targetMonths] = await Promise.all([
    db
      .select({ month: budgetAllocations.month })
      .from(budgetAllocations)
      .where(eq(budgetAllocations.accountId, acct))
      .groupBy(budgetAllocations.month),
    db
      .select({ month: budgetTargets.month })
      .from(budgetTargets)
      .where(eq(budgetTargets.accountId, acct))
      .groupBy(budgetTargets.month),
  ]);
  const keys = new Set<string>();
  for (const r of [...allocMonths, ...targetMonths]) keys.add(r.month.slice(0, 7));
  return [...keys].sort((a, b) => (a < b ? 1 : -1));
}

export interface PlanRevisionRow {
  id: string;
  createdAt: string;
  note: string | null;
  /** Display label for the author — name, else email, else "Unknown". */
  savedBy: string;
  /** Derived from the snapshot so the list needs no second read. */
  allocationCount: number;
  plannedTotal: number;
  plannedRevenueSar: number | null;
  reserveSpendUsd: number;
  weightOverrides: number;
  /**
   * The full snapshot, so the drawer can render the plan AND diff it against
   * the current one without a second round-trip. NULL when the stored shape no
   * longer parses — the row still lists, it just can't be restored.
   */
  snapshot: BudgetPlanSnapshot | null;
}

/**
 * A month's revisions, newest first, bounded at 50 — the drawer is a recent
 * history, not an archive. Summary numbers are derived from each snapshot in
 * JS; a snapshot that no longer parses is still listed (with zeroes) so the
 * row can be inspected rather than vanishing.
 */
export async function listPlanRevisions(
  month: string,
  limit = 50,
): Promise<PlanRevisionRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: budgetPlanRevisions.id,
      createdAt: budgetPlanRevisions.createdAt,
      note: budgetPlanRevisions.note,
      snapshot: budgetPlanRevisions.snapshot,
      name: users.name,
      email: users.email,
    })
    .from(budgetPlanRevisions)
    .leftJoin(users, eq(users.id, budgetPlanRevisions.savedBy))
    .where(
      and(
        eq(budgetPlanRevisions.accountId, acct),
        eq(budgetPlanRevisions.month, monthStartIso(month)),
      ),
    )
    .orderBy(desc(budgetPlanRevisions.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const parsed = storedSnapshotSchema.safeParse(r.snapshot);
    const snap = parsed.success ? parsed.data : null;
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      note: r.note,
      savedBy: r.name ?? r.email ?? "Unknown",
      allocationCount: snap?.allocations.length ?? 0,
      plannedTotal: snap?.allocations.reduce((s, a) => s + a.plannedSpend, 0) ?? 0,
      plannedRevenueSar: snap?.plannedRevenueSar ?? null,
      reserveSpendUsd: snap?.reserveSpendUsd ?? 0,
      weightOverrides: snap ? Object.keys(snap.dayWeights).length : 0,
      snapshot: snap,
    };
  });
}

export interface PlanRevisionDetail {
  id: string;
  /** YYYY-MM — the month the revision belongs to, NOT the caller's guess. */
  month: string;
  createdAt: string;
  note: string | null;
  snapshot: BudgetPlanSnapshot;
}

/**
 * One revision, ACCOUNT-SCOPED — a revision id from another brand simply is not
 * found. Returns null when the snapshot no longer matches the stored shape;
 * the restore action turns that into a loud error rather than applying half.
 */
export async function getPlanRevision(id: string): Promise<PlanRevisionDetail | null> {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({
      id: budgetPlanRevisions.id,
      month: budgetPlanRevisions.month,
      createdAt: budgetPlanRevisions.createdAt,
      note: budgetPlanRevisions.note,
      snapshot: budgetPlanRevisions.snapshot,
    })
    .from(budgetPlanRevisions)
    .where(and(eq(budgetPlanRevisions.accountId, acct), eq(budgetPlanRevisions.id, id)))
    .limit(1);
  if (!row) return null;
  const parsed = storedSnapshotSchema.safeParse(row.snapshot);
  if (!parsed.success) return null;
  return {
    id: row.id,
    month: row.month.slice(0, 7),
    createdAt: row.createdAt.toISOString(),
    note: row.note,
    snapshot: parsed.data,
  };
}

/**
 * Append a revision. ALWAYS called inside the same transaction as the write it
 * records, so a plan can never change without leaving a trace.
 */
export async function insertPlanRevision(
  exec: Exec,
  acct: string,
  month: string,
  snapshot: BudgetPlanSnapshot,
  note: string | null,
  savedBy: string | null,
): Promise<void> {
  await exec.insert(budgetPlanRevisions).values({
    accountId: acct,
    month: monthStartIso(month),
    snapshot,
    note: note && note.length > 0 ? note : null,
    savedBy,
  });
}
