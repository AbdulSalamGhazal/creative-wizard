"use client";

import Link from "next/link";
import { ArrowRight, Package, ShoppingBag, TrendingUp, Wallet } from "lucide-react";
import { MetricCard } from "@/components/overview/metric-card";
import { PlatformDot } from "@/components/ui/platform-dot";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { int, roas, sar } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  curveExpected,
  daysInMonth,
  elapsedDaysInMonth,
  monthKey,
  monthStartIso,
  pacingDeviation,
  pacingTone,
  pacingVerdict,
  projectedMonthEnd,
  roasThroughRate,
  validateRate,
  variancePct,
} from "@/lib/budget";
import type { BudgetMonthData } from "@/db/queries/budget";
import {
  BudgetMonthBar,
  CurrencyToggle,
  HorizonNote,
  formatSpend,
  platformAnchorId,
  useBudgetCurrency,
} from "@/components/budget/budget-shared";

/**
 * The Budget Overview page body — read-only month verdict: KPI tiles with
 * curve-based pacing + month-end projections, the reserve line, and per-
 * platform summary cards that deep-link into the Plan editor. All pacing goes
 * through the day-weight curve (ONE curve for spend and revenue); the reserve
 * is deliberately outside the curve.
 */
export function BudgetOverview({
  month,
  today,
  data,
  horizon,
  canManage,
}: {
  month: string; // YYYY-MM
  today: string; // ISO date
  data: BudgetMonthData;
  horizon: string | null;
  canManage: boolean;
}) {
  const [currency, pickCurrency] = useBudgetCurrency();
  const rate = data.usdToSarRate;
  const fmtSpend = (usdAmount: number) => formatSpend(usdAmount, currency, rate);

  const isCurrentMonth = monthKey(today) === month;
  const totalDays = daysInMonth(monthStartIso(month));
  const elapsed = elapsedDaysInMonth(month, today);
  const ov = data.dayWeightOverrides;

  const plannedByCombo = new Set(
    data.allocations.map((a) => `${a.platform}|${a.objective}`),
  );
  const totalPlanned = data.allocations.reduce((s, a) => s + a.plannedSpend, 0);
  const totalActual = data.actualSpendByCombo.reduce((s, c) => s + c.actualSpend, 0);
  // Reserve-used = the month's UNPLANNED actual spend (combos with no plan row).
  const unplannedActual = data.actualSpendByCombo
    .filter((c) => !plannedByCombo.has(`${c.platform}|${c.objective}`))
    .reduce((s, c) => s + c.actualSpend, 0);

  const spendDeviation = isCurrentMonth
    ? pacingDeviation(totalActual, curveExpected(totalPlanned, month, ov, elapsed))
    : null;
  const revenueDeviation =
    isCurrentMonth && data.plannedRevenueSar !== null
      ? pacingDeviation(
          data.actualRevenueSar,
          curveExpected(data.plannedRevenueSar, month, ov, elapsed),
        )
      : null;

  // Month-end projections (current month only): actual ÷ elapsed curve share.
  const projectedSpend = isCurrentMonth
    ? projectedMonthEnd(totalActual, month, ov, elapsed)
    : null;
  const projectedRevenue =
    isCurrentMonth ? projectedMonthEnd(data.actualRevenueSar, month, ov, elapsed) : null;

  const actualRoas = roasThroughRate(data.actualRevenueSar, totalActual, rate);
  const targetRoas =
    data.plannedRevenueSar !== null && totalPlanned > 0
      ? roasThroughRate(data.plannedRevenueSar, totalPlanned, rate)
      : null;

  const projLine = (
    projected: number | null,
    planned: number,
    fmt: (v: number) => string,
    reserveNote?: string,
  ) => {
    if (projected === null) return null;
    const pct = planned > 0 ? variancePct(projected, planned) : null;
    return (
      <span
        className={cn(
          "not-italic block",
          pacingTone(pct) === "warn" ? "text-warn" : "text-ink-3",
        )}
      >
        Projected: {fmt(projected)}
        {pct !== null && ` (${pct > 0 ? "+" : ""}${(pct * 100).toFixed(0)}% vs plan)`}
        {reserveNote && ` · ${reserveNote}`}
      </span>
    );
  };
  // Spend projection is judged against plan + reserve (the reserve exists to
  // absorb exactly this overshoot).
  const spendReserveNote =
    projectedSpend !== null && data.reserveSpendUsd > 0 && totalPlanned > 0 && projectedSpend > totalPlanned
      ? projectedSpend <= totalPlanned + data.reserveSpendUsd
        ? "within reserve"
        : "over even with reserve"
      : undefined;

  // Per-platform summary (plan ∪ actual, ALL_PLATFORMS order).
  const platforms = ALL_PLATFORMS.map((p) => {
    const planned = data.allocations
      .filter((a) => a.platform === p)
      .reduce((s, a) => s + a.plannedSpend, 0);
    const actual = data.actualSpendByCombo
      .filter((c) => c.platform === p)
      .reduce((s, c) => s + c.actualSpend, 0);
    const hasPlanRows = data.allocations.some((a) => a.platform === p);
    const hasActualRows = data.actualSpendByCombo.some((c) => c.platform === p);
    const dev = isCurrentMonth
      ? pacingDeviation(actual, curveExpected(planned, month, ov, elapsed))
      : null;
    return { platform: p, planned, actual, dev, shown: hasPlanRows || hasActualRows };
  }).filter((p) => p.shown);

  const hasPlan =
    data.allocations.length > 0 ||
    data.plannedRevenueSar !== null ||
    data.reserveSpendUsd > 0;

  return (
    <div className="space-y-4">
      <BudgetMonthBar month={month} today={today}>
        <CurrencyToggle currency={currency} onChange={pickCurrency} />
        {canManage && (
          <Link
            href={`/budget/plan?month=${month}`}
            className="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink transition-colors"
          >
            Edit plan
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </BudgetMonthBar>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Actual spend"
          value={fmtSpend(totalActual)}
          icon={Wallet}
          bars={[]}
          emptyText={
            <>
              <span className="not-italic block">
                Plan: {totalPlanned > 0 ? fmtSpend(totalPlanned) : "—"}
              </span>
              {totalPlanned > 0 || totalActual > 0
                ? projLine(projectedSpend, totalPlanned, fmtSpend, spendReserveNote)
                : null}
            </>
          }
        />
        <MetricCard
          label="Actual revenue"
          value={sar(data.actualRevenueSar)}
          icon={ShoppingBag}
          bars={[]}
          emptyText={
            <>
              <span className="not-italic block">
                Plan: {data.plannedRevenueSar !== null ? sar(data.plannedRevenueSar) : "—"}
              </span>
              {data.plannedRevenueSar !== null
                ? projLine(projectedRevenue, data.plannedRevenueSar, sar)
                : null}
            </>
          }
        />
        <MetricCard
          label="ROAS (via rate)"
          value={actualRoas === null ? "—" : roas(actualRoas)}
          icon={TrendingUp}
          bars={[]}
          emptyText={
            !validateRate(rate)
              ? "Set a USD→SAR rate to compute ROAS."
              : `Target: ${targetRoas === null ? "—" : roas(targetRoas)}`
          }
        />
        <MetricCard
          label="Actual orders"
          value={int(data.actualOrders)}
          icon={Package}
          bars={[]}
          emptyText="Context only — no plan."
        />
      </div>

      {/* Pacing verdict line (current month only, curve-based) */}
      {isCurrentMonth && (
        <p className="text-xs text-ink-3">
          Day {elapsed} of {totalDays}
          {" · "}
          spend{" "}
          <span className={pacingTone(spendDeviation) === "warn" ? "text-warn" : "text-ink-2"}>
            {spendDeviation === null ? "— no plan" : `${pacingVerdict(spendDeviation)} vs plan`}
          </span>
          {data.plannedRevenueSar !== null && (
            <>
              {" · "}
              revenue{" "}
              <span className={pacingTone(revenueDeviation) === "warn" ? "text-warn" : "text-ink-2"}>
                {revenueDeviation === null ? "—" : `${pacingVerdict(revenueDeviation)} vs plan`}
              </span>
            </>
          )}
        </p>
      )}

      {/* Reserve line — the reserve sits OUTSIDE the curve; "used" is the
          month's unplanned actual spend drawing it down. */}
      {(data.reserveSpendUsd > 0 ||
        (unplannedActual > 0 && data.allocations.length > 0)) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          <span className="text-label text-ink-3">Reserve</span>
          <span className="num tabular-nums text-ink">
            Plan {totalPlanned > 0 ? fmtSpend(totalPlanned) : "—"}
            {data.reserveSpendUsd > 0 && <> + {fmtSpend(data.reserveSpendUsd)} reserve</>}
          </span>
          <span
            className={cn(
              "num tabular-nums",
              unplannedActual > data.reserveSpendUsd ? "text-warn" : "text-ink-3",
            )}
          >
            Reserve used: {fmtSpend(unplannedActual)} of {fmtSpend(data.reserveSpendUsd)}
          </span>
          {unplannedActual > data.reserveSpendUsd && (
            <span className="text-xs text-warn">Unplanned spend exceeds the reserve.</span>
          )}
        </div>
      )}

      {/* Revenue block (read-only) */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
        <span className="text-label text-ink-3">Revenue target (SAR)</span>
        <span className="num tabular-nums text-ink">
          {data.plannedRevenueSar !== null ? sar(data.plannedRevenueSar) : "—"}
        </span>
        <span className="text-ink-3">
          actual <span className="num tabular-nums text-ink">{sar(data.actualRevenueSar)}</span>
        </span>
        <span className="text-ink-3">
          orders <span className="num tabular-nums text-ink">{int(data.actualOrders)}</span>
        </span>
        {isCurrentMonth && data.plannedRevenueSar !== null && (
          <span
            className={cn(
              "num text-xs",
              pacingTone(revenueDeviation) === "warn" ? "text-warn" : "text-ink-3",
            )}
          >
            {revenueDeviation === null ? "—" : pacingVerdict(revenueDeviation)}
          </span>
        )}
      </div>

      {/* Per-platform summary cards → Plan anchors */}
      {platforms.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {platforms.map((p) => (
            <Link
              key={p.platform}
              href={`/budget/plan?month=${month}#${platformAnchorId(p.platform)}`}
              className="group rounded-lg border border-line bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                  <PlatformDot platform={p.platform as never} size="sm" />
                  {PLATFORM_LABEL[p.platform as keyof typeof PLATFORM_LABEL] ?? p.platform}
                </span>
                {isCurrentMonth && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background:
                        pacingTone(p.dev) === "warn" ? "var(--warn)" : "var(--line-2)",
                    }}
                    title={p.dev === null ? "No pacing yet" : `Pacing: ${pacingVerdict(p.dev)}`}
                    aria-label={p.dev === null ? "No pacing yet" : `Pacing: ${pacingVerdict(p.dev)}`}
                  />
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs text-ink-3">
                <span className="num tabular-nums">
                  Planned {p.planned > 0 ? fmtSpend(p.planned) : "—"}
                </span>
                <span className="num tabular-nums">Actual {fmtSpend(p.actual)}</span>
              </div>
              {isCurrentMonth && (
                <div
                  className={cn(
                    "mt-1 text-[11px] num",
                    pacingTone(p.dev) === "warn" ? "text-warn" : "text-ink-3",
                  )}
                >
                  {p.dev === null ? "—" : `${pacingVerdict(p.dev)} vs plan`}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* Empty-plan hint */}
      {!hasPlan && (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
          <p className="text-sm text-ink-2">No plan for this month yet.</p>
          <p className="mt-1 text-xs text-ink-3">
            {canManage ? (
              <>
                Head to the{" "}
                <Link href={`/budget/plan?month=${month}`} className="underline hover:text-ink">
                  Plan page
                </Link>{" "}
                to add allocations.
              </>
            ) : (
              "Ask someone with budget access to add a plan."
            )}
          </p>
        </div>
      )}

      <HorizonNote horizon={horizon} />
    </div>
  );
}
