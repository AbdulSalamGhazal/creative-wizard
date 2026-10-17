"use client";

import { useMemo, useState } from "react";
import { Layers } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import { ChartHeader, ChartShell, ExpandButton } from "@/components/charts/chart-shell";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { MetricPicker } from "@/components/charts/metric-picker";
import { SeriesLegend } from "@/components/charts/series-legend";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FilterPill } from "@/components/filters/filter-pill";
import { FilterShell } from "@/components/filters/filter-shell";
import { useFilterParams } from "@/components/filters/use-filter-params";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL, seriesColor } from "@/lib/palette";
import { monthDay, roas as fmtRoas, sar, sarCompact, signedPct, usdCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BUDGET_OBJECTIVES,
  dayBucketsInRange,
  isoDaysBetween,
  monthBucketsInRange,
  pacingDeviation,
  pacingTone,
  pacingVerdict,
  roasThroughRate,
  round2,
  spendInDisplayCurrency,
  buildPlanSeries,
  stitchPlanByDay,
  weekBucketsInRange,
  type PlanSeries,
  type RangeBucket,
  type TrackerBar,
} from "@/lib/budget";
import type { PacingShape, PacingSplit } from "@/validators/budget";
import type { BudgetPacingSeries, MonthPlanRow } from "@/db/queries/budget";
import {
  CurrencyToggle,
  Hero,
  HeroVerdict,
  HorizonNote,
  PaceBar,
  PacingDevCell,
  anchorWords,
  formatSpend,
  platformLabel,
  useBudgetCurrency,
  type HeroState,
} from "@/components/budget/budget-shared";

export type GroupBy = "day" | "week" | "month";

interface RangeSide {
  state: HeroState;
  /** The last covered day inside the range (null = none yet). */
  through: string | null;
  bar: TrackerBar;
  projected: number | null;
  /**
   * Months in the range with actuals but NO plan on this side, and what was
   * spent (or earned) in them through coverage. A range like Apr–Sep with one
   * planned month has a plan to show but no pace to judge: the whole range's
   * actual against one month's expectation would read "+3206%", and a
   * projection over it is noise — so the card says this instead.
   */
  unplanned: { months: number; amount: number };
}

interface RangeCardData {
  spend: RangeSide;
  revenue: RangeSide;
  roas: {
    state: HeroState;
    through: string | null;
    actual: number | null;
    /** The on-plan ROAS to date (over the whole range before it starts). */
    target: number | null;
    projected: number | null;
  };
}

/**
 * The ROAS card's bar: a ratio against a target, so plan = tick = the target
 * and there is no verdict before any spend (actual null).
 */
function roasBar(target: number, actual: number | null): TrackerBar {
  return {
    key: "roas",
    label: "ROAS",
    plan: target,
    actual: actual ?? 0,
    planToDate: target,
    delta: (actual ?? 0) - target,
    deviation: actual === null ? null : pacingDeviation(actual, target),
  };
}

/**
 * The Overview's hero card, for a date range: the big number is the range's
 * actual, the context says what was planned for the range, ONE PaceBar
 * (track = the range's plan, fill = actual, tick = expected through coverage,
 * pale extension = projection) and the verdict line. A fully covered range
 * is "final for <range>"; a range with no plan shows the number and says so.
 */
function RangeCard({
  metric,
  title,
  card,
  fmtSpend,
  rate,
}: {
  metric: Metric;
  title: string;
  card: RangeCardData;
  fmtSpend: (usd: number) => string;
  rate: number;
}) {
  if (metric === "roas") {
    const r = card.roas;
    const rateNote = `at ${rate.toFixed(2)} SAR/USD`;
    if (r.target === null) {
      return (
        <Hero
          label="ROAS"
          value={fmtRoas(r.actual)}
          context={<>no plan for this range · {rateNote}</>}
        />
      );
    }
    const actual = r.actual ?? 0;
    const scale = Math.max(actual, r.target, r.projected ?? 0) * 1.15;
    const bar = roasBar(r.target, r.actual);
    if (r.state === "future") {
      return (
        <Hero
          label="ROAS"
          value={fmtRoas(r.target)}
          aside={<span className="text-[11px] text-ink-3">on plan</span>}
          context={<>for {title} · {rateNote}</>}
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
        value={fmtRoas(r.actual)}
        context={
          <>
            on plan <span className="num tabular-nums text-ink-2">{fmtRoas(r.target)}</span> for{" "}
            {title} · {rateNote}
          </>
        }
      >
        <div className="mt-3">
          <PaceBar
            bar={bar}
            fmt={fmtRoas}
            name="ROAS"
            scale={scale}
            projection={r.state === "live" ? r.projected : null}
            anchor={anchorWords(r.through)}
          />
        </div>
        <HeroVerdict
          bar={bar}
          fmt={fmtRoas}
          projected={r.state === "live" ? r.projected : null}
          state={r.state}
          finalLabel={title}
          variant="target"
          vsLabel="vs plan"
        />
      </Hero>
    );
  }

  const side = metric === "revenue" ? card.revenue : card.spend;
  const fmt = metric === "revenue" ? sar : fmtSpend;
  const label = metric === "revenue" ? "Revenue" : "Spend";
  const { bar } = side;
  if (bar.plan <= 0) {
    return <Hero label={label} value={fmt(bar.actual)} context="no plan for this range" />;
  }
  if (side.state === "future") {
    return (
      <Hero
        label={label}
        value={fmt(bar.plan)}
        aside={<span className="text-[11px] text-ink-3">planned</span>}
        context={<>for {title}</>}
      >
        <div className="mt-3">
          <PaceBar bar={bar} fmt={fmt} name={label} anchor="when it starts" />
        </div>
      </Hero>
    );
  }
  return (
    <Hero
      label={label}
      value={fmt(bar.actual)}
      context={
        <>
          of <span className="num tabular-nums text-ink-2">{fmt(bar.plan)}</span> planned for {title}
        </>
      }
    >
      <div className="mt-3">
        <PaceBar
          bar={bar}
          fmt={fmt}
          name={label}
          projection={side.state === "live" ? side.projected : null}
          anchor={anchorWords(side.through)}
        />
      </div>
      {side.unplanned.months > 0 ? (
        // Part of the range has actuals and no plan: the bar still shows the
        // range's plan against everything that happened, but a verdict and a
        // projection over that comparison would be noise — say why instead.
        <p className="mt-2 text-xs text-ink-3">
          <span className="num tabular-nums text-ink-2">{fmt(side.unplanned.amount)}</span> of it
          fell in {side.unplanned.months === 1 ? "a month" : `${side.unplanned.months} months`}{" "}
          with no plan — nothing to pace the whole range against.
        </p>
      ) : (
        <HeroVerdict
          bar={bar}
          fmt={fmt}
          projected={side.projected}
          state={side.state}
          finalLabel={title}
          vsLabel={metric === "revenue" ? "vs target" : "vs plan"}
        />
      )}
    </Hero>
  );
}

/**
 * "Sep 1 – Sep 30" within a year; "Oct 1, 2025 – Sep 30, 2026" across one.
 * A twelve-month range labelled without years reads as nine days.
 */
function rangeTitle(from: string, to: string): string {
  if (from.slice(0, 4) === to.slice(0, 4)) return `${monthDay(from)} – ${monthDay(to)}`;
  return `${monthDay(from)}, ${from.slice(0, 4)} – ${monthDay(to)}, ${to.slice(0, 4)}`;
}
type Metric = "spend" | "revenue" | "roas";

/** A platform's series key — prefixed so it can never collide with a bucket name. */
const platformKey = (platform: string) => `p:${platform}`;

/** The chart/table series: totals, or one per budget objective bucket. */
interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

const TOTAL_KEY = "total";

interface BucketRow {
  bucket: RangeBucket;
  /** seriesKey → actual spend in / through the bucket. */
  spend: Map<string, number>;
  spendCum: Map<string, number>;
  planSpend: Map<string, number>;
  planSpendCum: Map<string, number>;
  /** Revenue is a single all-platforms series — no attribution here. */
  revenue: number;
  revenueCum: number;
  planRevenue: number;
  planRevenueCum: number;
  /** Per side: nothing known yet / partly known, and how far. */
  spendUnknown: boolean;
  spendPartial: boolean;
  spendThrough: string | null;
  revenueUnknown: boolean;
  revenuePartial: boolean;
}

/**
 * Budget Pacing — plan vs actual over any date range.
 *
 * The plan is stored per MONTH, so it is spread across days by that month's
 * day-weight curve and re-summed per bucket; a range that spans months stitches
 * several curves together (`stitchPlanByDay`). Standing decisions hold: spend is
 * RAW (no exclusion filtering), store revenue has NO per-platform attribution
 * (that lives on Reconciliation), deviations are warn-tinted by magnitude rather
 * than green/red, and a period past its side's data horizon is UNKNOWN — an
 * em-dash and a line that stops, never a zero.
 *
 * 2026-10: the page answers "where and when did we drift" as well as "did we
 * follow the curve" — a RANGE CARD (the Overview's hero card for the range,
 * fed by the table's own totals), a three-way SPLIT (none · platform ·
 * objective; a platform split locks the metric to Spend like the platform
 * filter does) and a third chart SHAPE, Deviation (per-period actual − plan
 * around zero, warn-tinted by magnitude). Split and shape are remembered
 * per user per brand like the Tracker's view controls.
 */
export function BudgetPacing({
  from,
  to,
  groupBy,
  platforms,
  split,
  shape,
  series,
  plans,
  rate,
  horizon,
  storeHorizon,
}: {
  from: string;
  to: string;
  groupBy: GroupBy;
  /** Empty = every platform. */
  platforms: string[];
  /** The remembered split (URL → preference → "none"). */
  split: PacingSplit;
  /** The remembered chart shape (URL → preference → "cumulative"). */
  shape: PacingShape;
  series: BudgetPacingSeries;
  plans: MonthPlanRow[];
  rate: number;
  horizon: string | null;
  storeHorizon: string | null;
}) {
  // The shell's batching writer — the only URL writer on a migrated bar.
  // The platform selection is the only remembered filter here, and the page
  // already resolved it (URL → this user's saved value → all platforms) into
  // `platforms`. Handing that back as the writer's baseline is what makes
  // DESELECTING a remembered platform delete the preference: the param may
  // never have been in the URL at all.
  const { update } = useFilterParams({
    platforms: platforms.length > 0 ? platforms.join(",") : undefined,
    // The two view controls are remembered too; their defaults are "absent",
    // so choosing the default again deletes the preference (the house rule).
    split: split === "none" ? undefined : split,
    shape: shape === "cumulative" ? undefined : shape,
  });

  const [currency, pickCurrency] = useBudgetCurrency();
  const fmtSpend = (usdAmount: number) => formatSpend(usdAmount, currency, rate);

  const [metric, setMetric] = useState<Metric>("spend");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  // ── URL-backed controls ────────────────────────────────────────────────────
  /**
   * Pacing REBUILDS its query rather than mutating it — the page owns exactly
   * from/to/groupBy/platforms and deliberately drops anything else it was
   * handed (the Budget nav's `?month=`, say). Kept verbatim through the
   * shell's writer, so the URL it produces is unchanged.
   */
  const setParams = (next: Record<string, string | null>) =>
    update((params) => {
      for (const key of [...params.keys()]) params.delete(key);
      params.set("from", from);
      params.set("to", to);
      params.set("groupBy", groupBy);
      if (platforms.length > 0) params.set("platforms", platforms.join(","));
      if (split !== "none") params.set("split", split);
      if (shape !== "cumulative") params.set("shape", shape);
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
    });
  const setRange = (nextFrom: string | null, nextTo: string | null) => {
    if (!nextFrom || !nextTo) return; // Budget always compares a bounded range
    setParams({ from: nextFrom, to: nextTo });
  };
  const togglePlatform = (platform: string) => {
    const next = platforms.includes(platform)
      ? platforms.filter((p) => p !== platform)
      : [...platforms, platform];
    setParams({ platforms: next.join(",") });
  };

  // A platform filter — or a platform SPLIT — scopes the spend side only;
  // store revenue has no attribution, so revenue and ROAS drop back to Spend
  // rather than silently mixing a filtered numerator with an unfiltered
  // denominator.
  const platformFiltered = platforms.length > 0;
  const spendOnly = platformFiltered || split === "platform";
  const metricLocked = spendOnly && metric !== "spend";
  const activeMetric: Metric = metricLocked ? "spend" : metric;
  // ROAS has no per-period difference worth drawing (a ratio of two
  // cumulatives), so Deviation is unavailable there and falls back.
  const activeShape: PacingShape =
    activeMetric === "roas" && shape === "deviation" ? "cumulative" : shape;

  // ── Actual per day, scoped by the platform filter ──────────────────────────
  const inScope = (platform: string) =>
    platforms.length === 0 || platforms.includes(platform);

  /**
   * The platforms a platform split draws: in scope, and with a plan or any
   * spend somewhere in the range — a platform with neither has nothing to
   * show, and five empty blocks would be the "super detailed" the page must
   * not be. Always in `ALL_PLATFORMS` order.
   */
  const platformKeys = useMemo(() => {
    const seen = new Set<string>();
    for (const r of series.spend) seen.add(r.platform);
    for (const p of plans) for (const a of p.allocations) seen.add(a.platform);
    return ALL_PLATFORMS.filter((p) => inScope(p) && seen.has(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.spend, plans, platforms.join(",")]);

  // ── Series ─────────────────────────────────────────────────────────────────
  const seriesDefs: SeriesDef[] = useMemo(() => {
    if (split === "none" || activeMetric !== "spend") {
      return [
        {
          key: TOTAL_KEY,
          label: activeMetric === "revenue" ? "Revenue" : activeMetric === "roas" ? "ROAS" : "Spend",
          color: "var(--brand)",
        },
      ];
    }
    if (split === "platform") {
      // Each platform in its own colour — the tokens PlatformDot uses.
      return platformKeys.map((p) => ({
        key: platformKey(p),
        label: PLATFORM_LABEL[p],
        color: PLATFORM_COLOR[p],
      }));
    }
    return BUDGET_OBJECTIVES.map((o, i) => ({
      key: o,
      label: o,
      color: seriesColor(i),
    }));
  }, [split, activeMetric, platformKeys]);

  const shown = new Set(seriesDefs.filter((s) => !hidden.has(s.key)).map((s) => s.key));
  const toggleSeries = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const spendPerDay = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    const add = (key: string, date: string, value: number) => {
      let days = out.get(key);
      if (!days) out.set(key, (days = new Map()));
      days.set(date, (days.get(date) ?? 0) + value);
    };
    for (const r of series.spend) {
      if (!inScope(r.platform)) continue;
      add(TOTAL_KEY, r.date, r.spend);
      add(r.objective, r.date, r.spend);
      add(platformKey(r.platform), r.date, r.spend);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.spend, platforms.join(",")]);

  const revenuePerDay = useMemo(() => {
    const out = new Map<string, number>();
    for (const d of series.days) out.set(d.date, d.revenueSar);
    return out;
  }, [series.days]);

  // ── Plan per day, stitched across every month the range touches ────────────
  // Each month contributes its SERIES — a curve month its curve-expanded
  // allocations, a daily month its cells verbatim — so a range spanning both
  // kinds of month compares honestly. Nothing here expands a curve itself.
  const monthSeries: PlanSeries[] = useMemo(
    () =>
      plans.map((p) =>
        buildPlanSeries({
          month: p.month,
          planMode: p.planMode,
          allocations: p.allocations,
          plannedRevenueSar: p.plannedRevenueSar,
          dayWeights: p.dayWeights,
          planDays: p.planDays,
          targetRoas: p.targetRoas,
          usdToSarRate: rate,
        }),
      ),
    [plans, rate],
  );

  const planSpendPerDay = useMemo(() => {
    // A platform filter scopes the PLAN too, so the comparison stays honest.
    const scoped = (objective?: string) => (platform: string, o: string) =>
      inScope(platform) && (objective === undefined || o === objective);
    const out = new Map<string, Map<string, number>>();
    out.set(TOTAL_KEY, stitchPlanByDay(monthSeries, (m) => m.spendDays(scoped())));
    if (split === "none" || activeMetric !== "spend") return out;
    if (split === "platform") {
      // One stitched series per platform — its OWN allocations through the
      // series' slice machinery, never a curve expanded here.
      for (const platform of platformKeys) {
        out.set(
          platformKey(platform),
          stitchPlanByDay(monthSeries, (m) => m.spendDays((pl) => pl === platform)),
        );
      }
      return out;
    }
    // One stitched series per objective bucket, each from its own slice.
    for (const objective of BUDGET_OBJECTIVES) {
      out.set(objective, stitchPlanByDay(monthSeries, (m) => m.spendDays(scoped(objective))));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthSeries, split, activeMetric, platformKeys, platforms.join(",")]);

  const planRevenuePerDay = useMemo(
    () => stitchPlanByDay(monthSeries, (m) => m.revenueDays()),
    [monthSeries],
  );

  // ── Buckets ────────────────────────────────────────────────────────────────
  const buckets = useMemo(() => {
    if (groupBy === "week") return weekBucketsInRange(from, to);
    if (groupBy === "month") return monthBucketsInRange(from, to);
    return dayBucketsInRange(from, to);
  }, [groupBy, from, to]);

  const rows: BucketRow[] = useMemo(() => {
    const spendRun = new Map<string, number>();
    let revenueRun = 0;
    let planRevenueRun = 0;
    const planSpendRun = new Map<string, number>();

    return buckets.map((bucket) => {
      const spend = new Map<string, number>();
      const spendCum = new Map<string, number>();
      const planSpend = new Map<string, number>();
      const planSpendCum = new Map<string, number>();

      // A bucket is known only as far as its side's horizon reaches.
      const spendLast = horizon && horizon < bucket.end ? horizon : bucket.end;
      const spendUnknown = horizon === null || bucket.start > horizon;
      const spendPartial = !spendUnknown && horizon !== null && horizon < bucket.end;
      const revenueLast = storeHorizon && storeHorizon < bucket.end ? storeHorizon : bucket.end;
      const revenueUnknown = storeHorizon === null || bucket.start > storeHorizon;
      const revenuePartial =
        !revenueUnknown && storeHorizon !== null && storeHorizon < bucket.end;

      const eachDay = (last: string, fn: (iso: string) => void) => {
        for (const iso of isoDaysBetween(bucket.start, last)) fn(iso);
      };

      for (const key of [TOTAL_KEY, ...BUDGET_OBJECTIVES, ...platformKeys.map(platformKey)]) {
        let actual = 0;
        if (!spendUnknown) {
          const days = spendPerDay.get(key);
          if (days) eachDay(spendLast, (iso) => (actual += days.get(iso) ?? 0));
        }
        spend.set(key, actual);
        const nextActual = (spendRun.get(key) ?? 0) + actual;
        spendRun.set(key, nextActual);
        spendCum.set(key, nextActual);

        // The plan is known in advance, so it always covers the whole bucket.
        let planned = 0;
        const planDays = planSpendPerDay.get(key);
        if (planDays) eachDay(bucket.end, (iso) => (planned += planDays.get(iso) ?? 0));
        planSpend.set(key, planned);
        const nextPlan = (planSpendRun.get(key) ?? 0) + planned;
        planSpendRun.set(key, nextPlan);
        planSpendCum.set(key, nextPlan);
      }

      let revenue = 0;
      if (!revenueUnknown) {
        eachDay(revenueLast, (iso) => (revenue += revenuePerDay.get(iso) ?? 0));
      }
      revenueRun += revenue;
      let planRevenue = 0;
      eachDay(bucket.end, (iso) => (planRevenue += planRevenuePerDay.get(iso) ?? 0));
      planRevenueRun += planRevenue;

      return {
        bucket,
        spend,
        spendCum,
        planSpend,
        planSpendCum,
        revenue,
        revenueCum: revenueRun,
        planRevenue,
        planRevenueCum: planRevenueRun,
        spendUnknown,
        spendPartial,
        spendThrough: spendPartial ? spendLast : null,
        revenueUnknown,
        revenuePartial,
      };
    });
  }, [buckets, spendPerDay, planSpendPerDay, revenuePerDay, planRevenuePerDay, horizon, storeHorizon, platformKeys]);

  // ── Chart ──────────────────────────────────────────────────────────────────
  const toDisplay = (usdAmount: number) => spendInDisplayCurrency(usdAmount, currency, rate);

  /** ROAS for a bucket: revenue ÷ (spend × rate), on either side of the plan. */
  const roasOf = (revenueSar: number, spendUsd: number) =>
    roasThroughRate(revenueSar, spendUsd, rate);

  const chartData = useMemo(
    () =>
      rows.map((r) => {
        const point: Record<string, string | number | null> = { label: r.bucket.label };
        const cumulative = activeShape === "cumulative";
        if (activeMetric === "roas") {
          const actualRevenue = cumulative ? r.revenueCum : r.revenue;
          const actualSpend =
            cumulative ? (r.spendCum.get(TOTAL_KEY) ?? 0) : (r.spend.get(TOTAL_KEY) ?? 0);
          const planRevenue = cumulative ? r.planRevenueCum : r.planRevenue;
          const planSpend =
            cumulative ? (r.planSpendCum.get(TOTAL_KEY) ?? 0) : (r.planSpend.get(TOTAL_KEY) ?? 0);
          point[TOTAL_KEY] =
            r.spendUnknown || r.revenueUnknown ? null : roasOf(actualRevenue, actualSpend);
          point[`plan_${TOTAL_KEY}`] = roasOf(planRevenue, planSpend);
          return point;
        }
        if (activeMetric === "revenue") {
          point[TOTAL_KEY] = r.revenueUnknown ? null : cumulative ? r.revenueCum : r.revenue;
          const plan = cumulative ? r.planRevenueCum : r.planRevenue;
          point[`plan_${TOTAL_KEY}`] = plan > 0 ? plan : null;
          // Deviation: this period's actual − plan. Unknown period → nothing
          // (not zero); no plan → nothing to deviate from.
          const dev =
            r.revenueUnknown || r.planRevenue <= 0 ? null : r.revenue - r.planRevenue;
          point[`dev_${TOTAL_KEY}`] = dev;
          point[`warn_${TOTAL_KEY}`] =
            dev !== null && pacingTone(pacingDeviation(r.revenue, r.planRevenue)) === "warn" ? 1 : 0;
          return point;
        }
        for (const def of seriesDefs) {
          const actual = cumulative ? r.spendCum.get(def.key) : r.spend.get(def.key);
          point[def.key] = r.spendUnknown ? null : toDisplay(actual ?? 0);
          const plan = cumulative ? r.planSpendCum.get(def.key) : r.planSpend.get(def.key);
          point[`plan_${def.key}`] = plan && plan > 0 ? toDisplay(plan) : null;
          const periodActual = r.spend.get(def.key) ?? 0;
          const periodPlan = r.planSpend.get(def.key) ?? 0;
          const dev =
            r.spendUnknown || periodPlan <= 0 ? null : toDisplay(periodActual - periodPlan);
          point[`dev_${def.key}`] = dev;
          point[`warn_${def.key}`] =
            dev !== null && pacingTone(pacingDeviation(periodActual, periodPlan)) === "warn" ? 1 : 0;
        }
        return point;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, seriesDefs, activeShape, activeMetric, currency, rate],
  );

  const fmtValue = (v: number) =>
    activeMetric === "roas"
      ? fmtRoas(v)
      : activeMetric === "revenue"
        ? sar(v)
        : currency === "SAR"
          ? sar(v)
          : fmtSpend(v);
  const fmtAxis = (v: number) =>
    activeMetric === "roas"
      ? v.toFixed(1)
      : activeMetric === "revenue" || currency === "SAR"
        ? sarCompact(v)
        : usdCompact(v);

  // ── Table ──────────────────────────────────────────────────────────────────
  const dash = <span className="text-ink-3">—</span>;
  const devCell = (dev: number | null) => <PacingDevCell deviation={dev} />;

  const periodCol: DataColumn<BucketRow> = {
    key: "period",
    label: groupBy === "week" ? "Week" : groupBy === "month" ? "Month" : "Day",
    pinned: true,
    render: (r) => (
      // Phone-only cap: a WEEK label plus the "through …" suffix measures
      // ~298px, wider than a 375px viewport's scroll frame — and this cell is
      // pinned, so past that it stops pinning and scrolls off the left edge.
      <span className="inline-flex max-w-[12rem] items-center gap-1.5 sm:max-w-none">
        <span className="num truncate tabular-nums">{r.bucket.label}</span>
        {r.spendPartial && r.spendThrough && (
          <span className="shrink-0 text-label text-ink-3">
            through {monthDay(r.spendThrough)}
          </span>
        )}
      </span>
    ),
    csv: (r) => r.bucket.label,
    total: () => <span className="text-ink-3">Total</span>,
  };

  /** Does ANY month in the range carry a spend plan to compare against? */
  const hasSpendPlan = rows.some((r) => (r.planSpendCum.get(TOTAL_KEY) ?? 0) > 0);
  const lastKnownSpend = rows.filter((r) => !r.spendUnknown).at(-1);
  const lastKnownRevenue = rows.filter((r) => !r.revenueUnknown).at(-1);
  const lastRow = rows.at(-1);

  const columns: DataColumn<BucketRow>[] = useMemo(() => {
    if (activeMetric === "roas") {
      const actualRoas = (r: BucketRow) =>
        r.spendUnknown || r.revenueUnknown
          ? null
          : roasOf(r.revenueCum, r.spendCum.get(TOTAL_KEY) ?? 0);
      const planRoas = (r: BucketRow) =>
        roasOf(r.planRevenueCum, r.planSpendCum.get(TOTAL_KEY) ?? 0);
      return [
        periodCol,
        {
          key: "roas_actual",
          label: "ROAS",
          align: "right",
          render: (r) => {
            const v = actualRoas(r);
            return v === null ? dash : <span className="num tabular-nums">{fmtRoas(v)}</span>;
          },
          csv: (r) => actualRoas(r)?.toFixed(2) ?? "",
          total: () => {
            const v = lastKnownSpend ? actualRoas(lastKnownSpend) : null;
            return v === null ? dash : (
              <span className="num tabular-nums font-semibold">{fmtRoas(v)}</span>
            );
          },
        },
        {
          key: "roas_plan",
          label: "Target ROAS",
          align: "right",
          render: (r) => {
            const v = planRoas(r);
            return v === null ? dash : (
              <span className="num tabular-nums text-ink-3">{fmtRoas(v)}</span>
            );
          },
          csv: (r) => planRoas(r)?.toFixed(2) ?? "",
        },
        {
          key: "roas_dev",
          label: "Pacing",
          align: "right",
          render: (r) => {
            const a = actualRoas(r);
            const p = planRoas(r);
            // A planned ROAS of zero (a spend plan with no revenue target) is
            // nothing to deviate FROM — dividing by it would tint every row
            // warn off an Infinity.
            if (a === null || p === null || p <= 0) return dash;
            const diff = a - p;
            return (
              <span
                className={cn(
                  "num tabular-nums text-xs",
                  // Same magnitude rule as every other deviation in Budget —
                  // a ROAS miss is judged as a share of the planned ROAS.
                  pacingTone(diff / p) === "warn" ? "text-warn" : "text-ink-3",
                )}
              >
                {diff > 0 ? "+" : diff < 0 ? "−" : ""}
                {fmtRoas(Math.abs(diff))}
              </span>
            );
          },
          csv: (r) => {
            const a = actualRoas(r);
            const p = planRoas(r);
            return a === null || p === null || p <= 0 ? "" : (a - p).toFixed(2);
          },
        },
      ];
    }

    if (activeMetric === "revenue") {
      return [
        periodCol,
        {
          key: "revenue",
          label: "Revenue (SAR)",
          align: "right",
          render: (r) =>
            r.revenueUnknown ? dash : <span className="num tabular-nums">{sar(r.revenue)}</span>,
          csv: (r) => (r.revenueUnknown ? "" : r.revenue.toFixed(2)),
          total: () =>
            lastKnownRevenue ? (
              <span className="num tabular-nums font-semibold">
                {sar(lastKnownRevenue.revenueCum)}
              </span>
            ) : (
              dash
            ),
        },
        {
          key: "revenue_cum",
          label: "Cumulative (SAR)",
          align: "right",
          render: (r) =>
            r.revenueUnknown ? dash : (
              <span className="num tabular-nums">{sar(r.revenueCum)}</span>
            ),
          csv: (r) => (r.revenueUnknown ? "" : r.revenueCum.toFixed(2)),
        },
        {
          key: "revenue_plan",
          label: "Target-to-date (SAR)",
          align: "right",
          render: (r) =>
            r.planRevenueCum > 0 ? (
              <span className="num tabular-nums text-ink-3">{sar(r.planRevenueCum)}</span>
            ) : (
              dash
            ),
          csv: (r) => (r.planRevenueCum > 0 ? r.planRevenueCum.toFixed(2) : ""),
          total: () =>
            lastRow && lastRow.planRevenueCum > 0 ? (
              <span className="num tabular-nums font-semibold">{sar(lastRow.planRevenueCum)}</span>
            ) : (
              dash
            ),
        },
        {
          key: "revenue_dev",
          label: "Pacing",
          align: "right",
          render: (r) =>
            r.revenueUnknown || r.planRevenueCum <= 0
              ? dash
              : devCell(pacingDeviation(r.revenueCum, r.planRevenueCum)),
          csv: (r) =>
            r.revenueUnknown || r.planRevenueCum <= 0
              ? ""
              : pacingVerdict(pacingDeviation(r.revenueCum, r.planRevenueCum)),
        },
      ];
    }

    // Spend. One block per objective or per platform when split, else totals.
    const cols: DataColumn<BucketRow>[] = [periodCol];
    const isSplit = split !== "none";
    const blockKeys =
      split === "objective"
        ? [...BUDGET_OBJECTIVES, TOTAL_KEY]
        : split === "platform"
          ? [...platformKeys.map(platformKey), TOTAL_KEY]
          : [TOTAL_KEY];
    const blockName = (key: string) =>
      key === TOTAL_KEY
        ? "Total"
        : key.startsWith("p:")
          ? platformLabel(key.slice(2))
          : key;
    for (const key of blockKeys) {
      const isTotal = key === TOTAL_KEY;
      const name = blockName(key);
      cols.push(
        {
          key: `${key}_actual`,
          label: isSplit ? `${name} actual` : `Spend (${currency})`,
          align: "right",
          render: (r) =>
            r.spendUnknown ? dash : (
              <span className={cn("num tabular-nums", isTotal && isSplit && "font-medium")}>
                {fmtSpend(r.spend.get(key) ?? 0)}
              </span>
            ),
          csv: (r) =>
            r.spendUnknown
              ? ""
              : spendInDisplayCurrency(r.spend.get(key) ?? 0, currency, rate).toFixed(2),
          total: () =>
            lastKnownSpend ? (
              <span className="num tabular-nums font-semibold">
                {fmtSpend(lastKnownSpend.spendCum.get(key) ?? 0)}
              </span>
            ) : (
              dash
            ),
        },
        {
          key: `${key}_plan`,
          label: isSplit
            ? `${name} plan-to-date`
            : `Plan-to-date (${currency})`,
          align: "right",
          render: (r) =>
            // No plan anywhere in the range → a dash, not a column of $0.00.
            // The revenue side already reads this way; mirror it.
            hasSpendPlan ? (
              <span className="num tabular-nums text-ink-3">
                {fmtSpend(r.planSpendCum.get(key) ?? 0)}
              </span>
            ) : (
              dash
            ),
          csv: (r) =>
            hasSpendPlan
              ? spendInDisplayCurrency(r.planSpendCum.get(key) ?? 0, currency, rate).toFixed(2)
              : "",
          total: () =>
            lastRow && hasSpendPlan ? (
              <span className="num tabular-nums font-semibold">
                {fmtSpend(lastRow.planSpendCum.get(key) ?? 0)}
              </span>
            ) : (
              dash
            ),
        },
        {
          key: `${key}_dev`,
          label: isSplit ? `${name} pacing` : "Pacing",
          align: "right",
          render: (r) =>
            r.spendUnknown || !hasSpendPlan
              ? dash
              : devCell(
                  pacingDeviation(r.spendCum.get(key) ?? 0, r.planSpendCum.get(key) ?? 0),
                ),
          csv: (r) =>
            r.spendUnknown || !hasSpendPlan
              ? ""
              : pacingVerdict(
                  pacingDeviation(r.spendCum.get(key) ?? 0, r.planSpendCum.get(key) ?? 0),
                ),
        },
      );
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMetric, split, platformKeys, currency, rate, rows, groupBy, hasSpendPlan]);
  // The table's own columns control, remembered per user per brand.
  const columnKeys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.BUDGET_PACING,
    hideable: columnKeys,
    defaults: columnKeys,
  });


  // ── The range card ─────────────────────────────────────────────────────────
  // The Overview's hero card for the RANGE. Its numbers are the table's own
  // totals — actual at the last known row, plan at the last row — with the
  // expectation cut at the coverage DAY from the same stitched per-day plan
  // the rows are summed from (under Day grouping that is the totals row's
  // plan-to-date exactly; under Week/Month it is the honest number for a
  // partial last period). Never a second computation over the plan.
  const rangeCard = useMemo(() => {
    const clip = (h: string | null): string | null =>
      h && h >= from ? (h < to ? h : to) : null;
    const spendThrough = clip(horizon);
    const revenueThrough = clip(storeHorizon);
    const sumThrough = (map: Map<string, number> | undefined, through: string | null) => {
      if (!map || !through) return 0;
      let total = 0;
      for (const iso of isoDaysBetween(from, through)) total += map.get(iso) ?? 0;
      return total;
    };
    const stateOf = (through: string | null): HeroState =>
      through === null ? "future" : through >= to ? "final" : "live";
    const bar = (key: string, label: string, plan: number, actual: number, expected: number): TrackerBar => ({
      key,
      label,
      plan,
      actual,
      planToDate: expected,
      delta: round2(actual - expected),
      deviation: pacingDeviation(actual, expected),
    });
    // actual ÷ (expected ÷ plan): the module's coverage-fraction projection,
    // only while the range is still running.
    const project = (plan: number, actual: number, expected: number, state: HeroState) =>
      state === "live" && plan > 0 && expected > 0 ? round2((actual * plan) / expected) : null;

    // Months that have actuals through coverage but no plan on a side —
    // the one case where "actual vs the range's plan" has no honest verdict.
    const unplannedIn = (
      actualMap: Map<string, number> | undefined,
      through: string | null,
      planned: (month: string) => boolean,
    ) => {
      const byMonth = new Map<string, number>();
      if (actualMap && through) {
        for (const iso of isoDaysBetween(from, through)) {
          const v = actualMap.get(iso) ?? 0;
          if (v > 0) byMonth.set(iso.slice(0, 7), (byMonth.get(iso.slice(0, 7)) ?? 0) + v);
        }
      }
      let months = 0;
      let amount = 0;
      for (const [month, v] of byMonth) {
        if (planned(month)) continue;
        months += 1;
        amount += v;
      }
      return { months, amount: round2(amount) };
    };
    const spendPlanned = (month: string) =>
      plans.some((p) => p.month === month && p.allocations.length > 0);
    const revenuePlanned = (month: string) =>
      plans.some(
        (p) => p.month === month && (p.plannedRevenueSar !== null || p.targetRoas !== null),
      );

    const spendPlan = lastRow?.planSpendCum.get(TOTAL_KEY) ?? 0;
    const spendActual = lastKnownSpend?.spendCum.get(TOTAL_KEY) ?? 0;
    const spendExpected = sumThrough(planSpendPerDay.get(TOTAL_KEY), spendThrough);
    const spendState = stateOf(spendThrough);
    const spendUnplanned = unplannedIn(spendPerDay.get(TOTAL_KEY), spendThrough, spendPlanned);
    const spend = {
      state: spendState,
      through: spendThrough,
      bar: bar("spend", "Spend", spendPlan, spendActual, spendExpected),
      projected:
        spendUnplanned.months > 0
          ? null
          : project(spendPlan, spendActual, spendExpected, spendState),
      unplanned: spendUnplanned,
    };

    const revenuePlan = lastRow?.planRevenueCum ?? 0;
    const revenueActual = lastKnownRevenue?.revenueCum ?? 0;
    const revenueExpected = sumThrough(planRevenuePerDay, revenueThrough);
    const revenueState = stateOf(revenueThrough);
    const revenueUnplanned = unplannedIn(revenuePerDay, revenueThrough, revenuePlanned);
    const revenue = {
      state: revenueState,
      through: revenueThrough,
      bar: bar("revenue", "Revenue", revenuePlan, revenueActual, revenueExpected),
      projected:
        revenueUnplanned.months > 0
          ? null
          : project(revenuePlan, revenueActual, revenueExpected, revenueState),
      unplanned: revenueUnplanned,
    };

    // ROAS needs BOTH sides through the same day: the earlier of the two.
    const roasThrough =
      spendThrough && revenueThrough
        ? spendThrough < revenueThrough
          ? spendThrough
          : revenueThrough
        : null;
    const roasState = stateOf(roasThrough);
    const roasActual = roasOf(
      sumThrough(revenuePerDay, roasThrough),
      sumThrough(spendPerDay.get(TOTAL_KEY), roasThrough),
    );
    // The on-plan ROAS to date — the ROAS metric's own definition.
    const roasTarget = roasOf(
      sumThrough(planRevenuePerDay, roasThrough),
      sumThrough(planSpendPerDay.get(TOTAL_KEY), roasThrough),
    );
    // Over the whole range, for a range that hasn't started.
    const roasRangeTarget = roasOf(revenuePlan, spendPlan);
    const roasProjected =
      roasState === "live" && spend.projected !== null && revenue.projected !== null
        ? roasOf(revenue.projected, spend.projected)
        : null;
    return {
      spend,
      revenue,
      roas: {
        state: roasState,
        through: roasThrough,
        actual: roasActual,
        target: roasTarget ?? roasRangeTarget,
        projected: roasProjected,
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, plans, planSpendPerDay, planRevenuePerDay, spendPerDay, revenuePerDay, horizon, storeHorizon, from, to, rate]);

  /** Why Revenue and ROAS are unavailable under a platform filter or split. */
  const allPlatformsOnly =
    "All-platforms only — revenue isn't attributed to platforms";

  const platformFilterLabel =
    platforms.length === 0
      ? "All"
      : platforms.length === 1
        ? platformLabel(platforms[0]!)
        : `${platforms.length} selected`;

  return (
    <div className="space-y-4">
      {/* Controls — deliberately wrapping: on a phone they stack into rows
          rather than scrolling sideways. */}
      {/* The house filter bar (FilterShell, phase 2). A ZERO-DEF page: group-by
          and the objective breakdown are VIEW controls, not filters (the same
          reasoning as Reconciliation's mode toggle), so they are page-owned
          tier-1 slots and there is no Filters button or chips row. */}
      <FilterShell
        filters={[]}
        // The two view controls are remembered per user per brand (0049) —
        // declared here so the shell's writer treats them as preferences,
        // like the Tracker's board / rank / group.
        persistKeys={["split", "shape"]}
        tier1={({ fullWidth }) => (
          <>
            {/* Lifetime is hidden: an unbounded range has no plan to pace
                against, so the preset would silently do nothing. */}
            <DateRangePicker
              from={from}
              to={to}
              onChange={setRange}
              hidePresets={["lifetime"]}
              fullWidth={fullWidth}
            />

            <FilterPill
              icon={Layers}
              label="Platforms"
              value={platformFilterLabel}
              active={platformFiltered}
              fullWidth={fullWidth}
            >
              {() => (
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuLabel>Platforms</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {ALL_PLATFORMS.map((p) => (
                    <DropdownMenuCheckboxItem
                      key={p}
                      checked={platforms.includes(p)}
                      onCheckedChange={() => togglePlatform(p)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {PLATFORM_LABEL[p]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              )}
            </FilterPill>

            <SegmentedControl<GroupBy>
              ariaLabel="Group by"
              value={groupBy}
              onChange={(g) => setParams({ groupBy: g })}
              options={[
                { value: "day", label: "Day" },
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
              ]}
            />

            {/* Split by: none · platform · objective. A VIEW control, not a
                filter (Clear never touches it), remembered per user. */}
            <SegmentedControl<PacingSplit>
              ariaLabel="Split by"
              value={split}
              onChange={(v) => setParams({ split: v === "none" ? null : v })}
              options={[
                { value: "none", label: "None" },
                { value: "platform", label: "Platform" },
                { value: "objective", label: "Objective" },
              ]}
            />
          </>
        )}
        toolbar={() => <CurrencyToggle currency={currency} onChange={pickCurrency} />}
        notes={
          <>
            {metricLocked && (
              <p className="text-[11px] text-ink-3">
                Showing spend: store revenue isn&rsquo;t attributed to a platform (that
                lives on Reconciliation), so revenue and ROAS are all-platforms only.
              </p>
            )}
            {split === "objective" && activeMetric !== "spend" && (
              <p className="text-[11px] text-ink-3">
                The objective split applies to spend — revenue and ROAS have no
                objective split.
              </p>
            )}
          </>
        }
      />

      {/* The range card — the month's hero card, for this range */}
      <RangeCard
        metric={activeMetric}
        title={rangeTitle(from, to)}
        card={rangeCard}
        fmtSpend={fmtSpend}
        rate={rate}
      />

      {/* Chart */}
      <ChartShell
        ariaLabel="Budget pacing — expanded"
        legend={
          // ALWAYS shown. In the default view the plot is a solid line and a
          // dashed one with nothing saying which is which — the caption below
          // carries that, and the legend keeps the series toggles reachable.
          <div className="space-y-1">
            <SeriesLegend
              items={seriesDefs}
              shown={shown}
              onToggle={toggleSeries}
              onShowAll={() => setHidden(new Set())}
            />
            <p className="text-[11px] text-ink-3">
              {activeShape === "deviation"
                ? "Bars = this period\u2019s actual minus its plan · tinted when the period is off pace by 15% or more · no bar where the period has no plan or no data yet."
                : "Solid = actual · dashed = the plan, spread by each month\u2019s plan curve."}
            </p>
          </div>
        }
      >
        {({ inFull, toggleExpand }) => (
          <div className={inFull ? "flex flex-col h-full" : undefined}>
            <ChartHeader
              title={rangeTitle(from, to)}
              picker={
                <MetricPicker<Metric>
                  options={[
                    { value: "spend", label: "Spend" },
                    // Locked under a platform filter — shown, not hidden, so the
                    // reader can see the option exists and why it can't be used.
                    // Locked under a platform filter OR a platform split —
                    // shown, not hidden, so the reader can see the option
                    // exists and why it can't be used.
                    {
                      value: "revenue",
                      label: "Revenue",
                      disabled: spendOnly,
                      title: spendOnly ? allPlatformsOnly : undefined,
                    },
                    {
                      value: "roas",
                      label: "ROAS",
                      disabled: spendOnly,
                      title: spendOnly ? allPlatformsOnly : undefined,
                    },
                  ]}
                  value={activeMetric}
                  onChange={setMetric}
                />
              }
              controls={
                <>
                  <SegmentedControl<PacingShape>
                    ariaLabel="Chart view"
                    value={activeShape}
                    onChange={(v) => setParams({ shape: v === "cumulative" ? null : v })}
                    options={[
                      { value: "cumulative", label: "Cumulative" },
                      { value: "period", label: "Per-period" },
                      {
                        value: "deviation",
                        label: "Deviation",
                        disabled: activeMetric === "roas",
                        title:
                          activeMetric === "roas"
                            ? "ROAS is a ratio of two running totals — it has no per-period difference to draw"
                            : undefined,
                      },
                    ]}
                  />
                  <ExpandButton inFull={inFull} onClick={toggleExpand} />
                </>
              }
            />
            <div className={inFull ? "flex-1 min-h-0" : "h-64"}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                    tickMargin={6}
                    interval="preserveStartEnd"
                    minTickGap={16}
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
                      if (activeShape === "deviation") {
                        // Actual, plan and the signed difference per series —
                        // the row is the period itself.
                        const row = rows.find((r) => r.bucket.label === p.label);
                        return (
                          <ChartTooltip>
                            <div className="font-medium text-ink mb-1">{p.label}</div>
                            {seriesDefs
                              .filter((def) => shown.has(def.key))
                              .map((def) => {
                                const isRevenue = activeMetric === "revenue";
                                const unknown = row
                                  ? isRevenue
                                    ? row.revenueUnknown
                                    : row.spendUnknown
                                  : true;
                                const actual = row
                                  ? isRevenue
                                    ? row.revenue
                                    : (row.spend.get(def.key) ?? 0)
                                  : 0;
                                const plan = row
                                  ? isRevenue
                                    ? row.planRevenue
                                    : (row.planSpend.get(def.key) ?? 0)
                                  : 0;
                                const show = (v: number) =>
                                  isRevenue ? sar(v) : fmtSpend(v);
                                const diff = actual - plan;
                                return (
                                  <div key={def.key} className="mb-1 last:mb-0">
                                    <div className="flex items-center gap-2">
                                      <span
                                        className="h-2 w-2 rounded-full"
                                        style={{ background: def.color }}
                                      />
                                      <span className="text-ink-2">{def.label}</span>
                                    </div>
                                    <div className="grid grid-cols-[auto_1fr] gap-x-3 pl-4 text-ink-3">
                                      <span>actual</span>
                                      <span className="num tabular-nums text-right text-ink">
                                        {unknown ? "—" : show(actual)}
                                      </span>
                                      <span>plan</span>
                                      <span className="num tabular-nums text-right text-ink">
                                        {plan > 0 ? show(plan) : "—"}
                                      </span>
                                      <span>Δ</span>
                                      <span
                                        className={cn(
                                          "num tabular-nums text-right",
                                          !unknown && plan > 0 && pacingTone(pacingDeviation(actual, plan)) === "warn"
                                            ? "text-warn"
                                            : "text-ink",
                                        )}
                                      >
                                        {unknown || plan <= 0
                                          ? "—"
                                          : `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${show(Math.abs(diff))} (${signedPct(pacingDeviation(actual, plan), 0)})`}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                          </ChartTooltip>
                        );
                      }
                      return (
                        <ChartTooltip>
                          <div className="font-medium text-ink mb-1">{p.label}</div>
                          {p.payload.map((entry) => {
                            const key = String(entry.dataKey);
                            const isPlan = key.startsWith("plan_");
                            const def = seriesDefs.find(
                              (s) => s.key === (isPlan ? key.slice(5) : key),
                            );
                            return (
                              <div key={key} className="flex items-center gap-2">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ background: entry.color }}
                                />
                                <span className="text-ink-3">
                                  {isPlan ? `${def?.label ?? ""} plan` : (def?.label ?? key)}
                                </span>
                                <span className="num tabular-nums text-ink ml-auto">
                                  {typeof entry.value === "number" ? fmtValue(entry.value) : "—"}
                                </span>
                              </div>
                            );
                          })}
                        </ChartTooltip>
                      );
                    }}
                  />
                  {activeShape === "deviation" && (
                    <ReferenceLine y={0} stroke="var(--ink-3)" strokeWidth={1} />
                  )}
                  {activeShape === "deviation"
                    ? // Per-period actual − plan around zero, each bar tinted
                      // by ITS period's magnitude — the series colour when the
                      // period is within the threshold, warn when it is not.
                      seriesDefs
                        .filter((def) => shown.has(def.key))
                        .map((def) => (
                          <Bar
                            key={`dev_${def.key}`}
                            dataKey={`dev_${def.key}`}
                            fill={def.color}
                            radius={[2, 2, 2, 2]}
                            isAnimationActive={false}
                          >
                            {chartData.map((pt, i) => (
                              <Cell
                                key={i}
                                fill={pt[`warn_${def.key}`] === 1 ? "var(--warn)" : def.color}
                              />
                            ))}
                          </Bar>
                        ))
                    : seriesDefs
                    .filter((def) => shown.has(def.key))
                    .flatMap((def) => [
                      <Line
                        key={`plan_${def.key}`}
                        type="linear"
                        dataKey={`plan_${def.key}`}
                        stroke={seriesDefs.length > 1 ? def.color : "var(--ink-3)"}
                        strokeWidth={1.4}
                        strokeDasharray="5 4"
                        strokeOpacity={seriesDefs.length > 1 ? 0.55 : 1}
                        dot={false}
                        activeDot={{ r: 3 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />,
                      activeShape === "period" && activeMetric !== "roas" ? (
                        <Bar
                          key={def.key}
                          dataKey={def.key}
                          fill={def.color}
                          radius={[2, 2, 0, 0]}
                          isAnimationActive={false}
                        />
                      ) : (
                        <Line
                          key={def.key}
                          type="linear"
                          dataKey={def.key}
                          stroke={def.color}
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      ),
                    ])}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </ChartShell>

      {/* Period table */}
      <DataTable<BucketRow>
        columns={columns}
        {...cols.tableProps}
        rows={rows}
        rowKey={(r) => r.bucket.key}
        showTotals={rows.length > 0}
        minWidthClass={
          split !== "none" && activeMetric === "spend" ? "min-w-[1600px]" : "min-w-[720px]"
        }
        csvFileName={`budget-pacing-${from}-to-${to}-${groupBy}-${currency.toLowerCase()}`}
        rowClassName={(r) => cn(r.spendUnknown && "opacity-60")}
      />

      <HorizonNote horizon={horizon} storeHorizon={storeHorizon} />
    </div>
  );
}
