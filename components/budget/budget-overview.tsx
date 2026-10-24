"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import { Button } from "@/components/ui/button";
import { PlatformDot } from "@/components/ui/platform-dot";
import { ChartHeader, ChartShell, ExpandButton } from "@/components/charts/chart-shell";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { MetricPicker } from "@/components/charts/metric-picker";
import { SeriesLegend } from "@/components/charts/series-legend";
import { ALL_PLATFORMS } from "@/lib/palette";
import {
  int,
  monthDay,
  roas as fmtRoas,
  sar,
  sar0,
  sarCompact,
  usdCompact,
} from "@/lib/format";
import { useNavTransition } from "@/lib/nav-progress";
import {
  REVENUE_COVERAGE_KEY,
  buildPlanSeries,
  buildTrackerRows,
  cumulativeRoas,
  cumulativeSums,
  isoPlusDays,
  makeCoverageDay,
  monthChartPoints,
  monthEndIso,
  monthKey,
  monthLabel,
  monthStartIso,
  planSeriesSourceOf,
  roasFigures,
  MUTED_TONE,
  sortTrackerPlatforms,
  spendInDisplayCurrency,
  validateRate,
  type MonthChartPoint,
  type PlatformCoverage,
  type TrackerBar,
} from "@/lib/budget";
import type { BudgetMonthData, BudgetPacingSeries } from "@/db/queries/budget";
import {
  Amounts,
  BEHIND_STRONG,
  BudgetMonthBar,
  CoverageLaggards,
  CoverageLine,
  CurrencyToggle,
  Hero,
  HeroVerdict,
  HorizonNote,
  PaceBar,
  ReserveAmounts,
  ReserveVerdict,
  Verdict,
  anchorWords,
  formatSpend,
  laggardWords,
  platformLabel,
  useBudgetCurrency,
  type HeroState,
} from "@/components/budget/budget-shared";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Budget → Overview (rebuilt 2026-10): the month at a glance, in four pieces —
 * the month bar with what the comparisons counted through, three hero cards
 * (Spend · Revenue · ROAS, with ROAS on equal billing: the user may miss the
 * whole spend or the whole revenue, but must follow the ROAS target), ONE
 * cumulative chart, and the pace board — every planned line's bar, sorted
 * most-off-pace first, with the reserve last.
 *
 * NOTHING here is a second math path. Every pacing number is
 * `buildTrackerRows` — the same rows the Tracker draws — so the hero's total,
 * its projection, the board's rows and the Tracker agree to the cent; the
 * chart's day values come from the Pacing scan folded onto the month, its
 * plan from the plan SERIES, and its projection ENDS on the card's number.
 * Actuals are RAW (no exclusion filtering — the module's standing decision).
 */
export function BudgetOverview({
  month,
  today,
  data,
  series,
  horizon,
  storeHorizon,
  coverage,
  seedMonth,
  canManage,
}: {
  month: string; // YYYY-MM
  today: string; // ISO date
  data: BudgetMonthData;
  /** Per-day actuals for the month — the Pacing scan over [start, end]. */
  series: BudgetPacingSeries;
  horizon: string | null;
  /** The STORE horizon — this page shows revenue and orders too. */
  storeHorizon: string | null;
  /**
   * Latest uploaded day PER PLATFORM, plus the store horizon under
   * `REVENUE_COVERAGE_KEY`. Every comparison anchors to it — see
   * `makeCoverageDay` — never to the calendar.
   */
  coverage: PlatformCoverage;
  /** The most recent planned month before this one — drives the rollover nudge. */
  seedMonth: string | null;
  canManage: boolean;
}) {
  const [currency, pickCurrency] = useBudgetCurrency();
  const rate = data.usdToSarRate;
  const fmtSpend = (usdAmount: number) => formatSpend(usdAmount, currency, rate);
  // READINGS — verdicts, board amounts, the reserve row — in whole dollars;
  // the hero big numbers keep their cents because they are the exact actual.
  const fmtWhole = (usdAmount: number) => formatSpend(usdAmount, currency, rate, { whole: true });
  const router = useRouter();
  const [, startNav] = useNavTransition();
  /** Every link on this page navigates through the progress bar. */
  const go = (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    startNav(() => router.push(href));
  };

  // THE rows: the Tracker's — platform subtotal + bucket bars, the brand
  // total, the revenue bar, both projections, the reserve drawn. Nothing on
  // this page re-derives pacing.
  const t = useMemo(
    () => buildTrackerRows(data, month, today, coverage),
    [data, month, today, coverage],
  );
  const plan = useMemo(() => buildPlanSeries(planSeriesSourceOf(data, month)), [data, month]);
  const coverageDay = useMemo(
    () => makeCoverageDay(month, today, coverage),
    [month, today, coverage],
  );
  // The chart's actual lines stop at each side's coverage: spend at the
  // latest day any platform covers (the "data through" the header prints —
  // the laggards line says who trails it), revenue at the store's.
  const spendThroughDay = Math.max(0, ...ALL_PLATFORMS.map((p) => coverageDay(p)));
  const revenueThroughDay = coverageDay(REVENUE_COVERAGE_KEY);
  // ROAS needs BOTH sides through the same day: the EARLIEST of the store's
  // and every reporting platform's (W1-3, 2026-10-23). Revenue can't be cut
  // per platform, so a lagging side cuts the whole ratio — dividing revenue
  // through one day by spend through another read a month exactly at target
  // as "−32%" whenever the store upload lagged (audit B-04).
  const roasThroughDay = useMemo(() => {
    const reporting = t.platforms.map((p) => coverageDay(p.key)).filter((d) => d > 0);
    return reporting.length === 0 ? 0 : Math.min(revenueThroughDay, ...reporting);
  }, [t, coverageDay, revenueThroughDay]);
  const roasActuals = useMemo(() => {
    let spend = 0;
    let revenue = 0;
    for (const r of series.spend) {
      if (monthKey(r.date) === month && Number(r.date.slice(8, 10)) <= roasThroughDay) {
        spend += r.spend;
      }
    }
    for (const d of series.days) {
      if (monthKey(d.date) === month && Number(d.date.slice(8, 10)) <= roasThroughDay) {
        revenue += d.revenueSar;
      }
    }
    return { spend, revenue };
  }, [series, month, roasThroughDay]);

  const hasRate = validateRate(rate);
  const roas = useMemo(
    () =>
      roasFigures({
        // Both sides through the same day — the chart's ROAS line ends here too.
        actualRevenueSar: roasActuals.revenue,
        actualSpendUsd: roasActuals.spend,
        plannedRevenueSar: t.revenue.target,
        plannedSpendUsd: t.total.plan,
        // A daily month stores its target ROAS; a curve month derives it.
        targetRoas: data.planMode === "daily" ? data.targetRoas : null,
        projectedRevenueSar: t.projectedRevenue,
        projectedSpendUsd: t.projectedSpend,
        rate,
      }),
    [data, t, rate, roasActuals],
  );

  const monthStart = monthStartIso(month);
  const monthEnd = monthEndIso(month);

  if (!t.hasPlan) {
    return (
      <div className="space-y-4">
        <BudgetMonthBar month={month} today={today}>
          <CurrencyToggle currency={currency} onChange={pickCurrency} />
        </BudgetMonthBar>
        <EmptyMonth
          month={month}
          seedMonth={seedMonth}
          canManage={canManage}
          spent={t.total.actual}
          revenue={data.actualRevenueSar}
          fmt={fmtSpend}
          go={go}
        />
        <HorizonNote horizon={horizon} storeHorizon={storeHorizon} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <BudgetMonthBar month={month} today={today}>
          <CurrencyToggle currency={currency} onChange={pickCurrency} />
          {canManage && (
            <Link
              href={`/budget/plan?month=${month}`}
              onClick={go(`/budget/plan?month=${month}`)}
              className="inline-flex items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink"
            >
              Edit plan
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </BudgetMonthBar>
        {/* What every comparison below counted through — the same words, from
            the same rows, as the Tracker's header. */}
        <CoverageLine t={t} className="text-xs text-ink-2" />
        <CoverageLaggards coverage={t.coverage} />
      </div>

      {/* ── The three hero cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SpendCard
          t={t}
          reserve={data.reserveSpendUsd}
          fmt={fmtSpend}
          fmtWhole={fmtWhole}
          month={month}
        />
        <RevenueCard
          t={t}
          orders={data.actualOrders}
          storeThrough={coverage[REVENUE_COVERAGE_KEY] ?? null}
          month={month}
        />
        <RoasCard
          figures={roas}
          hasRate={hasRate}
          rate={rate}
          isCurrentMonth={t.isCurrentMonth}
          isPastMonth={t.isPastMonth}
          isFutureMonth={t.isFutureMonth}
          month={month}
        />
      </div>

      {/* ── The chart ─────────────────────────────────────────────────────── */}
      <MonthChart
        month={month}
        today={today}
        totalDays={t.totalDays}
        isCurrentMonth={t.isCurrentMonth}
        series={series}
        plan={plan}
        planTotal={t.total.plan}
        revenueTarget={t.revenue.target}
        projectedSpend={t.projectedSpend}
        projectedRevenue={t.projectedRevenue}
        projectedRoas={roas.projected}
        spendThroughDay={spendThroughDay}
        revenueThroughDay={revenueThroughDay}
        roasThroughDay={roasThroughDay}
        currency={currency}
        rate={rate}
        hasRate={hasRate}
        pacingHref={`/budget/pacing?from=${monthStart}&to=${monthEnd}`}
        go={go}
      />

      {/* ── The pace board ────────────────────────────────────────────────── */}
      <PaceBoard t={t} month={month} fmt={fmtWhole} coverage={coverage} go={go} />

      <HorizonNote horizon={horizon} storeHorizon={storeHorizon} />
    </div>
  );
}

// ── Hero cards ───────────────────────────────────────────────────────────────
// `Hero`, `HeroVerdict` and `anchorWords` live in budget-shared (2026-10):
// the Pacing page's range card is the same card for a date range.

/** The month's three clocks as the hero card's one state. */
function heroState(t: {
  isPastMonth: boolean;
  isCurrentMonth: boolean;
}): HeroState {
  return t.isPastMonth ? "final" : t.isCurrentMonth ? "live" : "future";
}

function SpendCard({
  t,
  reserve,
  fmt,
  fmtWhole,
  month,
}: {
  t: ReturnType<typeof buildTrackerRows>;
  reserve: number;
  /** The exact figure — the big number and its "of … + … reserve" line. */
  fmt: (v: number) => string;
  /** The reading — the bar's words and the verdict line, whole dollars. */
  fmtWhole: (v: number) => string;
  month: string;
}) {
  const bar = t.total;
  if (bar.plan <= 0) {
    // Nothing allocated: the number and the fact, nothing else.
    return <Hero label="Spend" value={fmt(bar.actual)} context="no plan" />;
  }
  if (t.isFutureMonth) {
    return (
      <Hero
        label="Spend"
        value={fmt(bar.plan)}
        aside={<span className="text-[11px] text-ink-3">planned</span>}
        context={
          reserve > 0 ? (
            <>
              + <span className="num tabular-nums text-ink-2">{fmt(reserve)}</span> reserve
            </>
          ) : null
        }
      >
        <div className="mt-3">
          <PaceBar bar={bar} fmt={fmtWhole} name="Spend" reserve={reserve} anchor="when it starts" />
        </div>
      </Hero>
    );
  }
  return (
    <Hero
      label="Spend"
      value={fmt(bar.actual)}
      context={
        <>
          of <span className="num tabular-nums text-ink-2">{fmt(bar.plan)}</span>
          {reserve > 0 && (
            <>
              {" "}
              + <span className="num tabular-nums text-ink-2">{fmt(reserve)}</span> reserve
            </>
          )}
        </>
      }
    >
      <div className="mt-3">
        <PaceBar
          bar={bar}
          fmt={fmtWhole}
          name="Spend"
          reserve={reserve}
          projection={t.isCurrentMonth ? t.projectedSpend : null}
          anchor={anchorWords(t.coverage?.through ?? null)}
        />
      </div>
      <HeroVerdict
        bar={bar}
        fmt={fmtWhole}
        projected={t.projectedSpend}
        reserve={reserve}
        state={heroState(t)}
        finalLabel={monthLabel(month)}
      />
    </Hero>
  );
}

function RevenueCard({
  t,
  orders,
  storeThrough,
  month,
}: {
  t: ReturnType<typeof buildTrackerRows>;
  orders: number;
  /** The store's last uploaded day — the revenue bar's own anchor. */
  storeThrough: string | null;
  month: string;
}) {
  const bar = t.revenue;
  const ordersAside = (
    <span className="num tabular-nums text-[11px] text-ink-3">{int(orders)} orders</span>
  );
  if (bar.target === null) {
    return <Hero label="Revenue" value={sar(bar.actual)} aside={ordersAside} context="no target" />;
  }
  if (t.isFutureMonth) {
    return (
      <Hero
        label="Revenue"
        value={sar(bar.target)}
        aside={<span className="text-[11px] text-ink-3">target</span>}
      >
        <div className="mt-3">
          <PaceBar bar={bar} fmt={sar0} name="Revenue" anchor="when it starts" />
        </div>
      </Hero>
    );
  }
  return (
    <Hero
      label="Revenue"
      value={sar(bar.actual)}
      aside={ordersAside}
      context={
        <>
          of <span className="num tabular-nums text-ink-2">{sar(bar.target)}</span>
        </>
      }
    >
      <div className="mt-3">
        <PaceBar
          bar={bar}
          fmt={sar0}
          name="Revenue"
          projection={t.isCurrentMonth ? t.projectedRevenue : null}
          anchor={anchorWords(storeThrough)}
        />
      </div>
      <HeroVerdict
        bar={bar}
        fmt={sar0}
        projected={t.projectedRevenue}
        state={heroState(t)}
        finalLabel={monthLabel(month)}
        vsLabel="vs target"
      />
    </Hero>
  );
}

function RoasCard({
  figures,
  hasRate,
  rate,
  isCurrentMonth,
  isPastMonth,
  isFutureMonth,
  month,
}: {
  figures: ReturnType<typeof roasFigures>;
  hasRate: boolean;
  rate: number;
  isCurrentMonth: boolean;
  isPastMonth: boolean;
  isFutureMonth: boolean;
  month: string;
}) {
  if (!hasRate) {
    return (
      <Hero label="ROAS" value="—" context="Set a USD→SAR rate to compute ROAS" />
    );
  }
  const rateNote = `at ${rate.toFixed(2)} SAR/USD`;
  if (figures.target === null) {
    return (
      <Hero
        label="ROAS"
        value={fmtRoas(figures.actual)}
        context={<>no target · {rateNote}</>}
      />
    );
  }
  // A ratio, not a cumulative: the bar is a plain axis from 0 to a little past
  // the larger of the readings, the tick is the target, the fill is actual.
  const actual = figures.actual ?? 0;
  const scale = Math.max(actual, figures.target, figures.projected ?? 0) * 1.15;
  const bar: TrackerBar = {
    key: "roas",
    label: "ROAS",
    plan: figures.target,
    actual,
    planToDate: figures.target,
    delta: actual - figures.target,
    deviation: figures.deviation,
  };
  if (isFutureMonth) {
    return (
      <Hero
        label="ROAS"
        value={fmtRoas(figures.target)}
        aside={<span className="text-[11px] text-ink-3">target</span>}
        context={rateNote}
      >
        <div className="mt-3">
          <PaceBar bar={bar} fmt={fmtRoas} name="ROAS" scale={scale} anchor="when it starts" />
        </div>
      </Hero>
    );
  }
  return (
    <Hero
      label="ROAS"
      value={fmtRoas(figures.actual)}
      context={
        <>
          target <span className="num tabular-nums text-ink-2">{fmtRoas(figures.target)}</span>{" "}
          · {rateNote}
        </>
      }
    >
      <div className="mt-3">
        <PaceBar
          bar={bar}
          fmt={fmtRoas}
          name="ROAS"
          scale={scale}
          projection={isCurrentMonth ? figures.projected : null}
          anchor="so far"
        />
      </div>
      {isPastMonth ? (
        <p className="mt-2 text-xs text-ink-3">final for {monthLabel(month)}</p>
      ) : (
        isCurrentMonth && (
          <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5 text-xs">
            <Verdict bar={bar} fmt={fmtRoas} variant="target" />
            {figures.projected !== null && (
              <span className="num tabular-nums text-ink-3">
                · projected {fmtRoas(figures.projected)}
              </span>
            )}
          </p>
        )
      )}
    </Hero>
  );
}

// ── The chart ────────────────────────────────────────────────────────────────

type Metric = "spend" | "revenue" | "roas";
type SeriesKey = "actual" | "plan" | "projection";

function MonthChart({
  month,
  today,
  totalDays,
  isCurrentMonth,
  series,
  plan,
  planTotal,
  revenueTarget,
  projectedSpend,
  projectedRevenue,
  projectedRoas,
  spendThroughDay,
  revenueThroughDay,
  roasThroughDay,
  currency,
  rate,
  hasRate,
  pacingHref,
  go,
}: {
  month: string;
  today: string;
  totalDays: number;
  isCurrentMonth: boolean;
  series: BudgetPacingSeries;
  plan: ReturnType<typeof buildPlanSeries>;
  planTotal: number;
  revenueTarget: number | null;
  projectedSpend: number | null;
  projectedRevenue: number | null;
  projectedRoas: number | null;
  spendThroughDay: number;
  revenueThroughDay: number;
  /** The earliest of the store's and every reporting platform's day. */
  roasThroughDay: number;
  currency: "USD" | "SAR";
  rate: number;
  hasRate: boolean;
  pacingHref: string;
  go: (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [metric, setMetric] = useState<Metric>("spend");
  const [hidden, setHidden] = useState<Set<SeriesKey>>(() => new Set());
  const activeMetric: Metric = metric === "roas" && !hasRate ? "spend" : metric;

  // The Pacing scan's sparse (date, platform, bucket) rows folded onto the
  // month's days — all platforms, since the chart is the brand's month.
  const spendCum = useMemo(() => {
    const days = new Array<number>(totalDays).fill(0);
    for (const r of series.spend) {
      const d = Number(r.date.slice(8, 10));
      if (d >= 1 && d <= totalDays) days[d - 1]! += r.spend;
    }
    return cumulativeSums(days);
  }, [series.spend, totalDays]);
  const revenueCum = useMemo(
    () => cumulativeSums(series.days.slice(0, totalDays).map((d) => d.revenueSar)),
    [series.days, totalDays],
  );
  // The plan, per day, from the SERIES — a curve month spread by its curve, a
  // daily month its cells verbatim — summed forward.
  const planSpendCum = useMemo(
    () => (planTotal > 0 ? cumulativeSums(plan.spendDays()) : null),
    [plan, planTotal],
  );
  const planRevenueCum = useMemo(() => {
    const days = plan.revenueDays();
    return days === null ? null : cumulativeSums(days);
  }, [plan]);

  const points: MonthChartPoint[] = useMemo(() => {
    if (activeMetric === "spend") {
      return monthChartPoints({
        totalDays,
        actualCumulative: spendCum,
        throughDay: spendThroughDay,
        planCumulative: planSpendCum,
        projected: planTotal > 0 ? projectedSpend : null,
      });
    }
    if (activeMetric === "revenue") {
      return monthChartPoints({
        totalDays,
        actualCumulative: revenueCum,
        throughDay: revenueThroughDay,
        planCumulative: planRevenueCum,
        projected: revenueTarget !== null ? projectedRevenue : null,
      });
    }
    // ROAS is a ratio of the two cumulatives; it is known only where BOTH
    // sides are, and its "plan" is the target — flat on a curve month, derived
    // day by day from the series' revenue and spend on a daily one.
    return monthChartPoints({
      totalDays,
      actualCumulative: cumulativeRoas(revenueCum, spendCum, rate),
      throughDay: roasThroughDay,
      planCumulative:
        planSpendCum !== null && planRevenueCum !== null
          ? cumulativeRoas(planRevenueCum, planSpendCum, rate)
          : null,
      projected: projectedRoas,
    });
  }, [
    activeMetric,
    totalDays,
    spendCum,
    revenueCum,
    planSpendCum,
    planRevenueCum,
    spendThroughDay,
    revenueThroughDay,
    roasThroughDay,
    planTotal,
    revenueTarget,
    projectedSpend,
    projectedRevenue,
    projectedRoas,
    rate,
  ]);

  const monthStart = monthStartIso(month);
  const toDisplay = (v: number | null) =>
    v === null ? null : activeMetric === "spend" ? spendInDisplayCurrency(v, currency, rate) : v;
  const chartData = useMemo(
    () =>
      points.map((p) => ({
        day: p.day,
        label: monthDay(isoPlusDays(monthStart, p.day - 1)),
        actual: toDisplay(p.actual),
        plan: toDisplay(p.plan),
        projection: toDisplay(p.projection),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, monthStart, activeMetric, currency, rate],
  );

  const fmtValue = (v: number) =>
    activeMetric === "roas"
      ? fmtRoas(v)
      : activeMetric === "revenue" || currency === "SAR"
        ? sar(v)
        : formatSpend(v, "USD", rate);
  const fmtAxis = (v: number) =>
    activeMetric === "roas"
      ? fmtRoas(v)
      : activeMetric === "revenue" || currency === "SAR"
        ? sarCompact(v)
        : usdCompact(v);

  const hasPlanLine = points.some((p) => p.plan !== null);
  const hasProjection = points.some((p) => p.projection !== null);
  const planLabel = activeMetric === "roas" ? "Target" : "Plan";
  const legendItems: Array<{ key: SeriesKey; label: string; color: string }> = [
    { key: "actual", label: "Actual", color: "var(--brand)" },
    ...(hasPlanLine ? [{ key: "plan" as const, label: planLabel, color: "var(--ink-3)" }] : []),
    ...(hasProjection
      ? [{ key: "projection" as const, label: "Projected", color: "var(--brand-2)" }]
      : []),
  ];
  const shown = new Set(legendItems.map((i) => i.key).filter((k) => !hidden.has(k)));
  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      const k = key as SeriesKey;
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const todayLabel = isCurrentMonth ? monthDay(today) : null;
  const roasTitle = hasRate ? undefined : "Set a USD→SAR rate to compute ROAS";

  return (
    <ChartShell
      ariaLabel="Budget month — expanded"
      legend={
        <SeriesLegend
          items={legendItems}
          shown={shown}
          onToggle={toggle}
          onShowAll={() => setHidden(new Set())}
        />
      }
    >
      {({ inFull, toggleExpand }) => (
        <div className={inFull ? "flex h-full flex-col" : undefined}>
          <ChartHeader
            title="Cumulative vs plan"
            picker={
              <MetricPicker<Metric>
                options={[
                  { value: "spend", label: "Spend" },
                  { value: "revenue", label: "Revenue" },
                  { value: "roas", label: "ROAS", disabled: !hasRate, title: roasTitle },
                ]}
                value={activeMetric}
                onChange={setMetric}
              />
            }
            controls={
              <>
                <Link
                  href={pacingHref}
                  onClick={go(pacingHref)}
                  className="inline-flex items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink"
                >
                  Open in Pacing
                  <ArrowRight className="h-3 w-3" />
                </Link>
                <ExpandButton inFull={inFull} onClick={toggleExpand} />
              </>
            }
          />
          <div className={inFull ? "min-h-0 flex-1" : "h-56 sm:h-64"}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                  tickMargin={6}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={fmtAxis}
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                  width={56}
                />
                <Tooltip
                  content={(p: TooltipProps<number, string>) => {
                    if (!p.active || !p.payload?.length) return null;
                    const rows = p.payload.filter(
                      (entry) => typeof entry.value === "number",
                    );
                    if (rows.length === 0) return null;
                    return (
                      <ChartTooltip>
                        <div className="mb-1 font-medium text-ink">{p.label}</div>
                        {rows.map((entry) => {
                          const key = String(entry.dataKey) as SeriesKey;
                          const def = legendItems.find((i) => i.key === key);
                          return (
                            <div key={key} className="flex items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: def?.color ?? entry.color }}
                              />
                              <span className="text-ink-3">{def?.label ?? key}</span>
                              <span className="num tabular-nums ml-auto text-ink">
                                {fmtValue(entry.value as number)}
                              </span>
                            </div>
                          );
                        })}
                      </ChartTooltip>
                    );
                  }}
                />
                {/* The calendar's today, so the gap between it and where the
                    actual line stops reads as what it is: days not uploaded
                    yet, not days with nothing spent. */}
                {todayLabel && (
                  <ReferenceLine
                    x={todayLabel}
                    stroke="var(--line-2)"
                    strokeDasharray="2 3"
                    label={{
                      value: "Today",
                      fill: "var(--ink-3)",
                      fontSize: 10,
                      position: "insideTopRight",
                    }}
                  />
                )}
                {shown.has("plan") && (
                  <Line
                    type="linear"
                    dataKey="plan"
                    stroke="var(--ink-3)"
                    strokeWidth={1.4}
                    strokeDasharray="5 4"
                    dot={false}
                    activeDot={{ r: 3 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}
                {shown.has("projection") && (
                  <Line
                    type="linear"
                    dataKey="projection"
                    stroke="var(--brand-2)"
                    strokeWidth={1.6}
                    strokeDasharray="2 4"
                    dot={false}
                    activeDot={{ r: 3 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}
                {shown.has("actual") && (
                  <Line
                    type="linear"
                    dataKey="actual"
                    stroke="var(--brand)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </ChartShell>
  );
}

// ── The pace board ───────────────────────────────────────────────────────────

/**
 * One row per platform — the Tracker's rows, biggest plan first, the
 * unplanned last — each followed by its buckets, smaller and indented, and the
 * Reserve as the last row. A platform row opens the Tracker filtered to it.
 * Every row is the SAME grid: label · bar · figures, so every bar starts at
 * one x and every verdict and amount sits right-aligned in one fixed column at
 * both levels; the label is muted, the amount is ink, the verdict is its
 * direction colour. On a phone the verdict rides the label's line and the
 * amounts sit under the bar.
 */
function PaceBoard({
  t,
  month,
  fmt,
  coverage,
  go,
}: {
  t: ReturnType<typeof buildTrackerRows>;
  month: string;
  fmt: (v: number) => string;
  coverage: PlatformCoverage;
  go: (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const rows = useMemo(() => sortTrackerPlatforms(t.platforms, "plan"), [t.platforms]);
  const anchorFor = (key: string) =>
    t.coverage ? anchorWords(coverage[key] ?? null) : "by today";
  const laggard = (key: string) => t.coverage?.laggards.find((l) => l.platform === key) ?? null;
  const reserveOver = t.reserveUsed > t.reserve;
  const showReserve = t.reserve > 0 || t.reserveUsed > 0;
  if (rows.length === 0 && !showReserve) return null;

  // label · bar · figures — the figures column is FIXED so verdicts and
  // amounts line up down the board; the verdict rides the label's line on a
  // phone so the bar gets the full width there.
  const grid =
    "grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_11rem] sm:items-center";

  return (
    <section className="rounded-lg border border-line bg-surface">
      <header className="border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-medium text-ink">Pace board</h2>
      </header>
      <ul className="divide-y divide-line">
        {rows.map((p) => {
          const href = `/budget/pacing?from=${monthStartIso(month)}&to=${monthEndIso(month)}&platforms=${p.key}`;
          const lag = laggard(p.key);
          return (
            <li key={p.key} className="px-4 py-3">
              <Link
                href={href}
                onClick={go(href)}
                className="group -mx-2 block rounded-md px-2 py-1 transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                aria-label={`${platformLabel(p.key)} — open in Pacing`}
              >
                <div className={grid}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-ink-2">
                      <PlatformDot platform={p.key} size="sm" />
                      <span className="truncate">{platformLabel(p.key)}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                    </span>
                    <span className="sm:hidden">
                      <Verdict bar={p} fmt={fmt} />
                    </span>
                  </div>
                  <div>
                    {p.plan > 0 ? (
                      <>
                        <PaceBar
                          bar={p}
                          fmt={fmt}
                          name={platformLabel(p.key)}
                          anchor={anchorFor(p.key)}
                        />
                        <Amounts bar={p} fmt={fmt} className="sm:hidden" />
                      </>
                    ) : (
                      // No plan → no track to draw against; the amount carries it.
                      <p
                        className="text-[11px] text-ink-3"
                        title="No plan for this platform this month — its spend draws on the reserve"
                      >
                        <span className="num tabular-nums text-ink">{fmt(p.actual)}</span> spent ·
                        no plan
                      </p>
                    )}
                  </div>
                  <div className="hidden text-right sm:block">
                    <Verdict bar={p} fmt={fmt} />
                    {p.plan > 0 && <Amounts bar={p} fmt={fmt} className="mt-0.5" />}
                  </div>
                </div>
              </Link>
              {lag && (
                <p
                  className="mt-1 text-[11px] text-ink-3 sm:pl-[calc(9rem+1rem)]"
                  title="Paced against the days its data covers, not the calendar"
                >
                  {laggardWords([lag])}
                </p>
              )}
              {p.buckets.length > 0 && (
                <ul className="mt-1.5 space-y-1.5">
                  {p.buckets.map((b) => (
                    <BucketRow key={b.key} bar={b} fmt={fmt} anchor={anchorFor(p.key)} grid={grid} />
                  ))}
                </ul>
              )}
              {p.unplanned > 0 && p.plan > 0 && (
                <p
                  className="mt-1.5 pl-5 text-[11px] text-ink-3"
                  title={`No allocation for ${p.unplannedBuckets.map((u) => u.label).join(", ")} — spend in a bucket the plan has no line for`}
                >
                  Unplanned{" "}
                  <span className="num tabular-nums text-ink">{fmt(p.unplanned)}</span>
                  {` · ${p.unplannedBuckets.map((u) => u.label).join(", ")}`}
                </p>
              )}
            </li>
          );
        })}
        {showReserve && (
          <li className="px-4 py-3">
            <div className={grid}>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2">
                  Reserve
                  <InfoTip label="What the reserve absorbs">
                    Spend beyond a platform&rsquo;s whole plan draws on the reserve. It is carved
                    out of the total and not paced.
                  </InfoTip>
                </span>
                <span className="sm:hidden">
                  <ReserveVerdict used={t.reserveUsed} reserve={t.reserve} fmt={fmt} />
                </span>
              </div>
              <div>
                {t.reserve > 0 && (
                  <PaceBar
                    bar={{
                      key: "reserve",
                      label: "Reserve",
                      plan: t.reserve,
                      actual: t.reserveUsed,
                      planToDate: 0,
                      delta: 0,
                      deviation: null,
                    }}
                    fmt={fmt}
                    name="Reserve"
                    tone={reserveOver ? BEHIND_STRONG : MUTED_TONE}
                    words={`Reserve: ${fmt(t.reserveUsed)} used of ${fmt(t.reserve)}${
                      reserveOver ? " — past the reserve" : ""
                    }`}
                  />
                )}
                <ReserveAmounts used={t.reserveUsed} reserve={t.reserve} fmt={fmt} className="sm:hidden" />
              </div>
              <div className="hidden text-right sm:block">
                <ReserveVerdict used={t.reserveUsed} reserve={t.reserve} fmt={fmt} />
                <ReserveAmounts used={t.reserveUsed} reserve={t.reserve} fmt={fmt} className="mt-0.5" />
              </div>
            </div>
          </li>
        )}
      </ul>
    </section>
  );
}

function BucketRow({
  bar,
  fmt,
  anchor,
  grid,
}: {
  bar: TrackerBar;
  fmt: (v: number) => string;
  anchor: string;
  grid: string;
}) {
  return (
    // Only the LABEL indents, so the bucket's track lines up under its
    // platform's and the eye can compare the two bars directly.
    <li className={grid}>
      <div className="flex items-center justify-between gap-2 pl-5">
        <span className="truncate text-xs text-ink-3">{bar.label}</span>
        <span className="sm:hidden">
          <Verdict bar={bar} fmt={fmt} small />
        </span>
      </div>
      <div>
        <PaceBar bar={bar} fmt={fmt} name={bar.label} small anchor={anchor} />
        <Amounts bar={bar} fmt={fmt} className="sm:hidden" />
      </div>
      <div className="hidden text-right sm:block">
        <Verdict bar={bar} fmt={fmt} small />
        <Amounts bar={bar} fmt={fmt} className="mt-0.5" />
      </div>
    </li>
  );
}

// ── Empty month ──────────────────────────────────────────────────────────────

function EmptyMonth({
  month,
  seedMonth,
  canManage,
  spent,
  revenue,
  fmt,
  go,
}: {
  month: string;
  seedMonth: string | null;
  canManage: boolean;
  /** Raw month-to-date spend (USD) and store revenue (SAR) — a month with
   *  uploads but no plan still says what happened. */
  spent: number;
  revenue: number;
  fmt: (v: number) => string;
  go: (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const planHref = `/budget/plan?month=${month}`;
  return (
    <EmptyState
      title="No plan for this month yet."
      hint={
        <>
          {/* Every brand's first month has uploads and no plan: the money is
              real, so it is named — only the pacing is missing. */}
          {(spent > 0 || revenue > 0) && (
            <p>
              {spent > 0 && (
                <>
                  <span className="num tabular-nums text-ink-2">{fmt(spent)}</span> spent
                </>
              )}
              {spent > 0 && revenue > 0 && " and "}
              {revenue > 0 && (
                <>
                  <span className="num tabular-nums text-ink-2">{sar(revenue)}</span> in revenue
                </>
              )}
              {" so far — nothing to pace it against yet."}
            </p>
          )}
          {canManage ? (
            seedMonth ? (
              <p className="mt-1">
                {monthLabel(seedMonth)} has one — carry it over, or plan this month from scratch.
              </p>
            ) : (
              <p className="mt-1">
                Head to the{" "}
                <Link href={planHref} onClick={go(planHref)} className="underline hover:text-ink">
                  Plan page
                </Link>{" "}
                to add allocations.
              </p>
            )
          ) : (
            <p className="mt-1">Ask someone with budget access to add a plan.</p>
          )}
        </>
      }
      action={
        canManage && seedMonth ? (
          <>
            <Button asChild size="sm">
              <Link href={planHref} onClick={go(planHref)}>
                Plan {monthLabel(month)}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/budget?month=${seedMonth}`} onClick={go(`/budget?month=${seedMonth}`)}>
                See {monthLabel(seedMonth)}
              </Link>
            </Button>
          </>
        ) : undefined
      }
    />
  );
}
