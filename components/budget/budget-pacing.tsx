"use client";

import { useMemo, useState } from "react";
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
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { PlatformsPill } from "@/components/filters/platforms-pill";
import { FilterShell } from "@/components/filters/filter-shell";
import type { FilterDef } from "@/components/filters/filter-model";
import { useFilterParams } from "@/components/filters/use-filter-params";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { ALL_PLATFORMS, PACING_COLOR, PLATFORM_COLOR, PLATFORM_LABEL, seriesColor } from "@/lib/palette";
import { monthDay, roas as fmtRoas, sar, sarCompact, signedPct, usdCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BUDGET_OBJECTIVES,
  MUTED_TONE,
  PACING_WARN_THRESHOLD,
  TOTAL_SERIES_KEY,
  buildPlanSeries,
  buildPlanSpendPerDay,
  buildRangeBoard,
  buildSpendPerDay,
  coveredThrough,
  dayBucketsInRange,
  expectedPlanPerDay,
  filterTrackerPlatforms,
  isStrongTone,
  isoDaysBetween,
  latestCoverage,
  monthBucketsInRange,
  pacingDeviation,
  pacingTone,
  pacingVerdict,
  platformSeriesKey,
  reserveUsed,
  lastDataIn,
  roasPeriodSides,
  roasThroughOf,
  roasThroughRate,
  round2,
  sortTrackerPlatforms,
  spendInDisplayCurrency,
  stitchPlanByDay,
  trackerCounts,
  weekBucketsInRange,
  type PacingTone,
  type PlanSeries,
  type PlatformCoverage,
  type RangeBucket,
  type TrackerBar,
} from "@/lib/budget";
import type { PacingShape, PacingSplit, PacingViewInput } from "@/validators/budget";
import { PacingBoard } from "@/components/budget/pacing-board";
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
  toneText,
  useBudgetCurrency,
  type HeroState,
} from "@/components/budget/budget-shared";

export type GroupBy = "day" | "week" | "month";

/**
 * A deviation bar's colour code for the chart row: +1 ahead / −1 behind once
 * the period's |deviation| passes the threshold (the bar takes its direction
 * colour), 0 otherwise (the series colour). Numeric so it rides the point.
 */
function strongToneCode(tone: PacingTone): 1 | -1 | 0 {
  if (!isStrongTone(tone)) return 0;
  return tone.direction === "ahead" ? 1 : -1;
}

/** The fill a deviation bar takes for its code — the direction colour, or the series'. */
function deviationFill(code: string | number | null | undefined, seriesColor: string): string {
  return code === 1 ? PACING_COLOR.ahead : code === -1 ? PACING_COLOR.behind : seriesColor;
}

interface RangeSide {
  state: HeroState;
  /** The last covered day inside the range (null = none yet). */
  through: string | null;
  /** The day the data REALLY reaches (≤ `through`; earlier in a month that is over). */
  lastData: string | null;
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
    lastData: string | null;
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
            anchor={anchorWords(r.through, r.lastData)}
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
          anchor={anchorWords(side.through, side.lastData)}
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

/** A platform's series key — the module's, so the board and the chart agree. */
const platformKey = platformSeriesKey;

/** The chart/table series: totals, or one per budget objective bucket. */
interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

const TOTAL_KEY = TOTAL_SERIES_KEY;

interface BucketRow {
  bucket: RangeBucket;
  /** seriesKey → actual spend in / through the bucket. */
  spend: Map<string, number>;
  spendCum: Map<string, number>;
  planSpend: Map<string, number>;
  planSpendCum: Map<string, number>;
  /**
   * What the plan EXPECTED in / through the bucket: each platform's plan only
   * through its own covered day (`expectedPlanPerDay`). Every pacing verdict
   * compares against THIS; the full plan above is a display figure (W1-2).
   */
  expected: Map<string, number>;
  expectedCum: Map<string, number>;
  /** Series keys with nothing covered in this bucket (a lagging platform). */
  spendUnknownBy: Set<string>;
  /** Revenue is a single all-platforms series — no attribution here. */
  revenue: number;
  revenueCum: number;
  planRevenue: number;
  planRevenueCum: number;
  /** The revenue target through the store's covered day, same rule. */
  expectedRevenue: number;
  expectedRevenueCum: number;
  /**
   * ROAS's own sums: BOTH sides through the same day — the earliest of the
   * store's and every reporting platform's (`roasThrough`, the range card's
   * rule). A partly covered last period used to divide revenue through the
   * store's day by spend through the ads' day. The plan side is cut at the
   * same day, except in a period nothing has reached yet (the whole period).
   */
  roasUnknown: boolean;
  roasRevenue: number;
  roasRevenueCum: number;
  roasSpend: number;
  roasSpendCum: number;
  roasPlanRevenue: number;
  roasPlanRevenueCum: number;
  roasPlanSpend: number;
  roasPlanSpendCum: number;
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
 * (that lives on Reconciliation), deviations are coloured by DIRECTION (ahead
 * blue, behind amber, strong past the magnitude threshold) rather than
 * green/red, and a period past its side's data horizon is UNKNOWN — an
 * em-dash and a line that stops, never a zero.
 *
 * 2026-10: the page answers "where and when did we drift" as well as "did we
 * follow the curve" — a RANGE CARD (the Overview's hero card for the range,
 * fed by the table's own totals), a three-way SPLIT (none · platform ·
 * objective; a platform split locks the metric to Spend like the platform
 * filter does) and a third chart SHAPE, Deviation (per-period actual − plan
 * around zero, each bar in its direction colour past the threshold). Split
 * and shape are remembered per user per brand.
 *
 * 2026-10-19 (user decision): THE TRACKER MERGED IN. Below the chart sits the
 * BOARD — one row per platform for the RANGE with its stage rows, each a
 * PaceBar with the projection extension, a daily sparkline (actual over plan)
 * and what each remaining day needs — built by `buildRangeBoard` from the
 * SAME per-day maps the chart and the period table are summed from. Its
 * table view, row order, grouping and tier-2 filters (`board` · `rank` ·
 * `group` · `buckets` · `offpace`) are the Tracker's, remembered under the
 * same keys; the per-period table lives under the chart, closed by default.
 */
export function BudgetPacing({
  from,
  to,
  groupBy,
  platforms,
  split,
  shape,
  view,
  resolved,
  coverage,
  canManage,
  series,
  plans,
  rate,
  today,
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
  /** The board's remembered controls and tier-2 filters (URL → preference → default). */
  view: Pick<PacingViewInput, "board" | "rank" | "group" | "buckets" | "offpace">;
  /** What the server resolved for every remembered key — the writer's baseline (0049). */
  resolved: Record<string, string | undefined>;
  /** Latest uploaded day per platform — the board's anchor, never the calendar. */
  coverage: PlatformCoverage;
  canManage: boolean;
  series: BudgetPacingSeries;
  plans: MonthPlanRow[];
  rate: number;
  /**
   * Today (business TZ). A month before today's is over, so it reads as
   * covered to its end (`coveredThrough`) — the Overview's past-month rule.
   */
  today: string;
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
    // The board's remembered controls and tier-2 filters, as the server
    // resolved them — so deselecting a remembered one deletes the preference.
    buckets: resolved.buckets,
    offpace: resolved.offpace,
    board: resolved.board,
    rank: resolved.rank,
    group: resolved.group,
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
      if (view.buckets.length > 0) params.set("buckets", view.buckets.join(","));
      if (view.offpace) params.set("offpace", "1");
      if (view.board !== "bars") params.set("board", view.board);
      if (view.rank !== "plan") params.set("rank", view.rank);
      if (view.group !== "platform") params.set("group", view.group);
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
  // The board's writers: a remembered control (its default deletes the
  // preference), a multi filter, a flag — through the shell's one writer.
  const writeOne = (key: string, value: string, fallback: string) =>
    update((p) => {
      if (value === fallback) p.delete(key);
      else p.set(key, value);
    });
  const writeMulti = (key: string, values: readonly string[]) =>
    update((p) => {
      if (values.length === 0) p.delete(key);
      else p.set(key, values.join(","));
    });
  const writeFlag = (key: string, on: boolean) =>
    update((p) => {
      if (on) p.set(key, "1");
      else p.delete(key);
    });

  // Tier 2: the bucket slice, and the one toggle that makes a long board short.
  const defs: FilterDef[] = [
    {
      key: "buckets",
      label: "Bucket",
      type: "multi",
      options: BUDGET_OBJECTIVES.map((o) => ({ value: o, label: o })),
      values: view.buckets,
      onChange: (next) => writeMulti("buckets", next),
    },
    {
      key: "offpace",
      label: "Off-pace only",
      type: "multi",
      // ONE option, deliberately: the shell's multi gives it a chip, a count
      // and a Clear for free, and the label says exactly what it hides —
      // "off-pace" is both directions, not just the bad news.
      options: [
        {
          value: "1",
          label: `Hide rows within ${Math.round(PACING_WARN_THRESHOLD * 100)}% of pace`,
        },
      ],
      values: view.offpace ? ["1"] : [],
      onChange: (next) => writeFlag("offpace", next.length > 0),
      chipFormat: () => "On",
    },
  ];

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

  // Keyed by total · objective · platform · platform × objective — the chart,
  // the period table and the board sum from this ONE map.
  const spendPerDay = useMemo(
    () => buildSpendPerDay(series.spend, inScope),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series.spend, platforms.join(",")],
  );

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

  // The plan under the same keys, every slice stitched through the series'
  // own machinery (never a curve expanded here); the platform filter scopes
  // the plan too, so the comparison stays honest.
  const planSpendPerDay = useMemo(
    () => buildPlanSpendPerDay(monthSeries, platformKeys, inScope),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monthSeries, platformKeys, platforms.join(",")],
  );

  const planRevenuePerDay = useMemo(
    () => stitchPlanByDay(monthSeries, (m) => m.revenueDays()),
    [monthSeries],
  );

  // ── Coverage: each platform through ITS OWN last covered day ──────────────
  // "Pacing compares against DATA COVERAGE": every verdict on this page —
  // the range card, the chart, the period table, the board — expects each
  // platform's plan only through the days that platform has reported, and a
  // total is the SUM of those expectations. (Before 2026-10-23 the card, the
  // chart and the table cut at the LATEST platform's day, so one lagging
  // upload made on-plan spend read behind — audit B-03.)
  const throughByPlatform = useMemo(
    () =>
      new Map<string, string | null>(
        platformKeys.map((p) => [p, coveredThrough(coverage[p], from, to, today)]),
      ),
    [platformKeys, coverage, from, to, today],
  );
  /** The spend side's "data through": the latest any in-scope platform covers. */
  const spendThrough = useMemo(
    () => latestCoverage(Object.fromEntries(throughByPlatform)),
    [throughByPlatform],
  );
  const revenueThrough = coveredThrough(storeHorizon, from, to, today);
  /**
   * ROAS needs BOTH sides through the same day. Revenue can't be cut per
   * platform (no attribution), so the day is the EARLIEST of the store's and
   * every reporting in-scope platform's — a lagging platform's unreported days
   * never enter the spend side as $0. ONE value for the card, the chart and
   * the period table (W3, 2026-10: the table and chart cut each side at its
   * own day).
   */
  const roasThrough = useMemo(
    () => roasThroughOf(revenueThrough, platformKeys.map((p) => throughByPlatform.get(p) ?? null)),
    [platformKeys, throughByPlatform, revenueThrough],
  );
  /** What the footnote prints: the in-scope platforms' raw last upload. */
  const horizon = useMemo(
    () =>
      latestCoverage(
        Object.fromEntries(ALL_PLATFORMS.filter(inScope).map((p) => [p, coverage[p]])),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coverage, platforms.join(",")],
  );
  /** A series' own covered day: a platform's, else the spend side's. */
  const throughOfKey = (key: string): string | null =>
    key.startsWith("p:") ? (throughByPlatform.get(key.slice(2)) ?? null) : spendThrough;

  const expectedPerDay = useMemo(
    () =>
      expectedPlanPerDay(planSpendPerDay, platformKeys, (p) => throughByPlatform.get(p) ?? null),
    [planSpendPerDay, platformKeys, throughByPlatform],
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

    const expectedRun = new Map<string, number>();
    let expectedRevenueRun = 0;
    let roasRevenueRun = 0;
    let roasSpendRun = 0;
    let roasPlanRevenueRun = 0;
    let roasPlanSpendRun = 0;

    return buckets.map((bucket) => {
      const spend = new Map<string, number>();
      const spendCum = new Map<string, number>();
      const planSpend = new Map<string, number>();
      const planSpendCum = new Map<string, number>();
      const expected = new Map<string, number>();
      const expectedCum = new Map<string, number>();
      const spendUnknownBy = new Set<string>();

      // A bucket is known only as far as its side's covered day reaches —
      // per series: a platform through ITS day, a total or objective through
      // the latest in-scope platform's (its lagging members expect nothing
      // past their own day, via `expectedPerDay`).
      const spendUnknown = spendThrough === null || bucket.start > spendThrough;
      const spendLast = spendThrough && spendThrough < bucket.end ? spendThrough : bucket.end;
      const spendPartial = !spendUnknown && spendThrough !== null && spendThrough < bucket.end;
      const revenueLast =
        revenueThrough && revenueThrough < bucket.end ? revenueThrough : bucket.end;
      const revenueUnknown = revenueThrough === null || bucket.start > revenueThrough;
      const revenuePartial =
        !revenueUnknown && revenueThrough !== null && revenueThrough < bucket.end;

      const eachDay = (last: string, fn: (iso: string) => void) => {
        for (const iso of isoDaysBetween(bucket.start, last)) fn(iso);
      };

      for (const key of [TOTAL_KEY, ...BUDGET_OBJECTIVES, ...platformKeys.map(platformKey)]) {
        const keyThrough = throughOfKey(key);
        const keyUnknown = keyThrough === null || bucket.start > keyThrough;
        if (keyUnknown) spendUnknownBy.add(key);
        let actual = 0;
        if (!keyUnknown) {
          const days = spendPerDay.get(key);
          const last = keyThrough < bucket.end ? keyThrough : bucket.end;
          if (days) eachDay(last, (iso) => (actual += days.get(iso) ?? 0));
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

        // …and what it expected of the days actually reported.
        let exp = 0;
        const expDays = expectedPerDay.get(key);
        if (expDays) eachDay(bucket.end, (iso) => (exp += expDays.get(iso) ?? 0));
        expected.set(key, exp);
        const nextExp = (expectedRun.get(key) ?? 0) + exp;
        expectedRun.set(key, nextExp);
        expectedCum.set(key, nextExp);
      }

      let revenue = 0;
      if (!revenueUnknown) {
        eachDay(revenueLast, (iso) => (revenue += revenuePerDay.get(iso) ?? 0));
      }
      revenueRun += revenue;
      let planRevenue = 0;
      eachDay(bucket.end, (iso) => (planRevenue += planRevenuePerDay.get(iso) ?? 0));
      planRevenueRun += planRevenue;
      let expectedRevenue = 0;
      if (!revenueUnknown) {
        eachDay(revenueLast, (iso) => (expectedRevenue += planRevenuePerDay.get(iso) ?? 0));
      }
      expectedRevenueRun += expectedRevenue;

      // ROAS: both sides through `roasThrough` (see BucketRow).
      const {
        unknown: roasUnknown,
        revenue: roasRevenue,
        spend: roasSpend,
        planRevenue: roasPlanRevenue,
        planSpend: roasPlanSpend,
      } = roasPeriodSides(bucket, roasThrough, {
        revenue: revenuePerDay,
        spend: spendPerDay.get(TOTAL_KEY),
        planRevenue: planRevenuePerDay,
        planSpend: planSpendPerDay.get(TOTAL_KEY),
      });
      roasRevenueRun += roasRevenue;
      roasSpendRun += roasSpend;
      roasPlanRevenueRun += roasPlanRevenue;
      roasPlanSpendRun += roasPlanSpend;

      return {
        roasUnknown,
        roasRevenue,
        roasRevenueCum: roasRevenueRun,
        roasSpend,
        roasSpendCum: roasSpendRun,
        roasPlanRevenue,
        roasPlanRevenueCum: roasPlanRevenueRun,
        roasPlanSpend,
        roasPlanSpendCum: roasPlanSpendRun,
        bucket,
        spend,
        spendCum,
        planSpend,
        planSpendCum,
        expected,
        expectedCum,
        spendUnknownBy,
        revenue,
        revenueCum: revenueRun,
        planRevenue,
        planRevenueCum: planRevenueRun,
        expectedRevenue,
        expectedRevenueCum: expectedRevenueRun,
        spendUnknown,
        spendPartial,
        spendThrough: spendPartial ? spendLast : null,
        revenueUnknown,
        revenuePartial,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, spendPerDay, planSpendPerDay, expectedPerDay, revenuePerDay, planRevenuePerDay, spendThrough, revenueThrough, roasThrough, throughByPlatform, platformKeys]);

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
          // Both sides through the same day (`roasThrough`), like the card.
          const actualRevenue = cumulative ? r.roasRevenueCum : r.roasRevenue;
          const actualSpend = cumulative ? r.roasSpendCum : r.roasSpend;
          const planRevenue = cumulative ? r.roasPlanRevenueCum : r.roasPlanRevenue;
          const planSpend = cumulative ? r.roasPlanSpendCum : r.roasPlanSpend;
          point[TOTAL_KEY] = r.roasUnknown ? null : roasOf(actualRevenue, actualSpend);
          point[`plan_${TOTAL_KEY}`] = roasOf(planRevenue, planSpend);
          return point;
        }
        if (activeMetric === "revenue") {
          point[TOTAL_KEY] = r.revenueUnknown ? null : cumulative ? r.revenueCum : r.revenue;
          const plan = cumulative ? r.planRevenueCum : r.planRevenue;
          point[`plan_${TOTAL_KEY}`] = plan > 0 ? plan : null;
          // Deviation: this period's actual − what the plan expected of its
          // covered days. Unknown period → nothing (not zero); nothing
          // expected → nothing to deviate from.
          const dev =
            r.revenueUnknown || r.expectedRevenue <= 0 ? null : r.revenue - r.expectedRevenue;
          point[`dev_${TOTAL_KEY}`] = dev;
          point[`tone_${TOTAL_KEY}`] =
            dev === null
              ? 0
              : strongToneCode(pacingTone(pacingDeviation(r.revenue, r.expectedRevenue)));
          return point;
        }
        for (const def of seriesDefs) {
          // Each series stops at ITS own covered day — a lagging platform's
          // line ends where its data does, never dropping to zero.
          const unknown = r.spendUnknownBy.has(def.key);
          const actual = cumulative ? r.spendCum.get(def.key) : r.spend.get(def.key);
          point[def.key] = unknown ? null : toDisplay(actual ?? 0);
          const plan = cumulative ? r.planSpendCum.get(def.key) : r.planSpend.get(def.key);
          point[`plan_${def.key}`] = plan && plan > 0 ? toDisplay(plan) : null;
          // Deviation is against what the plan EXPECTED of the period's
          // covered days, so a partial last period isn't judged on its whole
          // plan (audit B-05).
          const periodActual = r.spend.get(def.key) ?? 0;
          const periodExpected = r.expected.get(def.key) ?? 0;
          const dev =
            unknown || periodExpected <= 0 ? null : toDisplay(periodActual - periodExpected);
          point[`dev_${def.key}`] = dev;
          point[`tone_${def.key}`] =
            dev === null
              ? 0
              : strongToneCode(pacingTone(pacingDeviation(periodActual, periodExpected)));
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
      // Both sides through the same day (`roasThrough`), like the card.
      const actualRoas = (r: BucketRow) =>
        r.roasUnknown ? null : roasOf(r.roasRevenueCum, r.roasSpendCum);
      const planRoas = (r: BucketRow) => roasOf(r.roasPlanRevenueCum, r.roasPlanSpendCum);
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
            const lastKnownRoas = rows.filter((r) => !r.roasUnknown).at(-1);
            const v = lastKnownRoas ? actualRoas(lastKnownRoas) : null;
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
                  // Same direction + threshold rule as every other deviation
                  // in Budget — a ROAS miss is judged as a share of the planned ROAS.
                  toneText(pacingTone(diff / p)),
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
          // Against the target through the store's covered day — a partial
          // period is judged on the days it covers (B-05).
          render: (r) =>
            r.revenueUnknown || r.expectedRevenueCum <= 0
              ? dash
              : devCell(pacingDeviation(r.revenueCum, r.expectedRevenueCum)),
          csv: (r) =>
            r.revenueUnknown || r.expectedRevenueCum <= 0
              ? ""
              : pacingVerdict(pacingDeviation(r.revenueCum, r.expectedRevenueCum)),
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
            r.spendUnknownBy.has(key) ? dash : (
              <span className={cn("num tabular-nums", isTotal && isSplit && "font-medium")}>
                {fmtSpend(r.spend.get(key) ?? 0)}
              </span>
            ),
          csv: (r) =>
            r.spendUnknownBy.has(key)
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
          // Actual against what the plan EXPECTED of the covered days, never
          // the bucket's whole plan: a partial last Week/Month, or a platform
          // whose upload lags, is not "behind" (audit B-03/B-05).
          render: (r) =>
            r.spendUnknownBy.has(key) || !hasSpendPlan
              ? dash
              : devCell(
                  pacingDeviation(r.spendCum.get(key) ?? 0, r.expectedCum.get(key) ?? 0),
                ),
          csv: (r) =>
            r.spendUnknownBy.has(key) || !hasSpendPlan
              ? ""
              : pacingVerdict(
                  pacingDeviation(r.spendCum.get(key) ?? 0, r.expectedCum.get(key) ?? 0),
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


  // ── The board ──────────────────────────────────────────────────────────────
  // The Tracker's rows for the RANGE, from the same per-day maps as above —
  // each platform through its own covered day, a past month final.
  const boardData = useMemo(
    () =>
      buildRangeBoard({
        from,
        to,
        spendPerDay,
        planSpendPerDay,
        platforms: platformKeys,
        coverage,
        today,
      }),
    [from, to, spendPerDay, planSpendPerDay, platformKeys, coverage, today],
  );

  // ── The range card ─────────────────────────────────────────────────────────
  // The Overview's hero card for the RANGE. Spend is the BOARD's own rows
  // summed — actual, plan, and an expectation that is the SUM of the rows'
  // expectations, each platform through its own covered day (the house rule;
  // until 2026-10-23 the card expected the whole plan through the LATEST
  // platform's day, so a lagging upload read as "behind" — audit B-03).
  // Revenue paces against the store's own covered day. Never a second
  // computation over the plan.
  const rangeCard = useMemo(() => {
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

    // The board's rows, summed. The range hasn't started while NO platform
    // has a covered day in it; it is FINAL only once every planned platform
    // is covered to its end (a past month always is). A planned platform
    // with no data yet expects nothing — the row has no verdict, and neither
    // does a total that sums to nothing expected.
    const boardRows = boardData.platforms;
    const judged = boardRows.some((p) => p.plan > 0)
      ? boardRows.filter((p) => p.plan > 0)
      : boardRows;
    const spendPlan = round2(boardRows.reduce((a, p) => a + p.plan, 0));
    const spendActual = round2(boardRows.reduce((a, p) => a + p.actual, 0));
    const spendExpected = round2(boardRows.reduce((a, p) => a + p.planToDate, 0));
    const spendState: HeroState =
      spendThrough === null
        ? "future"
        : judged.length > 0 && judged.every((p) => p.through !== null && p.through >= to)
          ? "final"
          : "live";
    const spendUnplanned = unplannedIn(spendPerDay.get(TOTAL_KEY), spendThrough, spendPlanned);
    const spend = {
      state: spendState,
      through: spendThrough,
      lastData: lastDataIn(horizon, spendThrough),
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
      lastData: lastDataIn(storeHorizon, revenueThrough),
      bar: bar("revenue", "Revenue", revenuePlan, revenueActual, revenueExpected),
      projected:
        revenueUnplanned.months > 0
          ? null
          : project(revenuePlan, revenueActual, revenueExpected, revenueState),
      unplanned: revenueUnplanned,
    };

    // ROAS needs BOTH sides through the same day. Revenue can't be cut per
    // platform (no attribution), so the day is the EARLIEST of the store's and
    // every reporting platform's — a lagging platform's unreported days never
    // enter the spend side as $0.
    // `roasThrough` — the one cut the chart and the table use too.
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
        lastData: lastDataIn(
          roasThroughOf(storeHorizon, platformKeys.map((p) => coverage[p] ?? null)),
          roasThrough,
        ),
        actual: roasActual,
        target: roasTarget ?? roasRangeTarget,
        projected: roasProjected,
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, plans, boardData, planSpendPerDay, planRevenuePerDay, spendPerDay, revenuePerDay, spendThrough, revenueThrough, roasThrough, horizon, storeHorizon, platformKeys, coverage, from, to, rate]);

  // The view's own rows: filtered, then ordered. The triage counts ignore the
  // off-pace toggle — otherwise the chip you clicked to get here would read 0.
  const boardRows = useMemo(
    () =>
      sortTrackerPlatforms(
        filterTrackerPlatforms(boardData.platforms, {
          buckets: view.buckets,
          offPaceOnly: view.offpace,
        }),
        view.rank,
      ),
    [boardData.platforms, view.buckets, view.offpace, view.rank],
  );
  const boardCounts = useMemo(
    () => trackerCounts(filterTrackerPlatforms(boardData.platforms, { buckets: view.buckets })),
    [boardData.platforms, view.buckets],
  );
  // The reserve is a MONTH's figure (the platform-level rule, `reserveUsed`):
  // read when the range sits inside one planned month, a dash otherwise.
  const singleMonth = from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : null;
  const monthPlan = singleMonth ? plans.find((p) => p.month === singleMonth) : undefined;
  const boardReserve =
    monthPlan && monthPlan.allocations.length > 0
      ? {
          kind: "month" as const,
          used: reserveUsed(
            monthPlan.allocations,
            boardData.platforms.map((p) => ({ platform: p.key, actualSpend: p.actual })),
          ),
          reserve: monthPlan.reserveSpendUsd,
        }
      : { kind: "none" as const };
  // READINGS on the board are whole dollars; the period table keeps its cents.
  const fmtWhole = (usdAmount: number) => formatSpend(usdAmount, currency, rate, { whole: true });

  /** Why Revenue and ROAS are unavailable under a platform filter or split. */
  const allPlatformsOnly =
    "All-platforms only — revenue isn't attributed to platforms";

  return (
    <div className="space-y-4">
      {/* Controls — deliberately wrapping: on a phone they stack into rows
          rather than scrolling sideways. */}
      {/* The house filter bar (FilterShell, phase 2). Group-by and the split
          are VIEW controls, not filters (the same reasoning as Reconciliation's
          mode toggle), so they are page-owned tier-1 slots; the board's bucket
          slice and off-pace toggle are the page's two tier-2 filters. */}
      <FilterShell
        filters={defs}
        // The view controls — the chart's two and the board's three — are
        // remembered per user per brand (0049): declared here so the shell's
        // writer treats them as preferences, never as filters Clear can reach.
        persistKeys={["split", "shape", "board", "rank", "group"]}
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

            <PlatformsPill
              options={ALL_PLATFORMS}
              selected={platforms}
              onToggle={togglePlatform}
              fullWidth={fullWidth}
            />

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
            {/* Show, don't label: the legend and the dash style already say
                solid vs dashed; only the Deviation shape's tint rule needs words. */}
            {activeShape === "deviation" && (
              <p className="text-[11px] text-ink-3">
                Bars = this period&rsquo;s actual minus its plan · tinted when the period is off
                pace by 15% or more · no bar where the period has no plan or no data yet.
              </p>
            )}
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
                                          toneText(
                                            !unknown && plan > 0
                                              ? pacingTone(pacingDeviation(actual, plan))
                                              : MUTED_TONE,
                                            "text-ink",
                                          ),
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
                    ? // Per-period actual − plan around zero, each bar coloured
                      // by ITS period's verdict — the series colour inside the
                      // threshold, the direction colour (ahead / behind) past it.
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
                                fill={deviationFill(pt[`tone_${def.key}`], def.color)}
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

      {/* The per-period table — data, with its cents — under the chart and
          closed by default; the board below is the page's reading. */}
      <CollapsibleSection
        title="Periods"
        subtitle={`${rows.length} ${groupBy === "day" ? "days" : groupBy === "week" ? "weeks" : "months"}`}
      >
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
      </CollapsibleSection>

      {/* The board: every platform's pace for the range, with its stages. */}
      <PacingBoard
        from={from}
        to={to}
        title={rangeTitle(from, to)}
        rows={boardRows}
        totalRows={boardData.platforms.length}
        counts={boardCounts}
        board={view.board}
        rank={view.rank}
        group={view.group}
        offPace={view.offpace}
        onBoard={(v) => writeOne("board", v, "bars")}
        onRank={(v) => writeOne("rank", v, "plan")}
        onGroup={(v) => writeOne("group", v, "platform")}
        onBehind={() => writeFlag("offpace", !view.offpace)}
        reserve={boardReserve}
        fmt={fmtWhole}
        toDisplay={toDisplay}
        currency={currency}
        planMonth={singleMonth}
        canManage={canManage}
      />

      <HorizonNote horizon={horizon} storeHorizon={storeHorizon} />
    </div>
  );
}
