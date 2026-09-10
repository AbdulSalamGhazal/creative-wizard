"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Layers } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
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
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FilterPill } from "@/components/filters/filter-pill";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { ALL_PLATFORMS, PLATFORM_LABEL, seriesColor } from "@/lib/palette";
import { monthDay, roas as fmtRoas, sar, sarCompact, usdCompact } from "@/lib/format";
import { useNavTransition } from "@/lib/nav-progress";
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
  spendInDisplayCurrency,
  stitchPlanByDay,
  weekBucketsInRange,
  type MonthPlan,
  type RangeBucket,
} from "@/lib/budget";
import type { BudgetPacingSeries, MonthPlanRow } from "@/db/queries/budget";
import {
  CurrencyToggle,
  HorizonNote,
  PacingDevCell,
  formatSpend,
  platformLabel,
  useBudgetCurrency,
} from "@/components/budget/budget-shared";

export type GroupBy = "day" | "week" | "month";

/**
 * "Sep 1 – Sep 30" within a year; "Oct 1, 2025 – Sep 30, 2026" across one.
 * A twelve-month range labelled without years reads as nine days.
 */
function rangeTitle(from: string, to: string): string {
  if (from.slice(0, 4) === to.slice(0, 4)) return `${monthDay(from)} – ${monthDay(to)}`;
  return `${monthDay(from)}, ${from.slice(0, 4)} – ${monthDay(to)}, ${to.slice(0, 4)}`;
}
type Metric = "spend" | "revenue" | "roas";
type View = "cumulative" | "period";

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
 */
export function BudgetPacing({
  from,
  to,
  groupBy,
  platforms,
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
  series: BudgetPacingSeries;
  plans: MonthPlanRow[];
  rate: number;
  horizon: string | null;
  storeHorizon: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startNav] = useNavTransition();

  const [currency, pickCurrency] = useBudgetCurrency();
  const fmtSpend = (usdAmount: number) => formatSpend(usdAmount, currency, rate);

  const [metric, setMetric] = useState<Metric>("spend");
  const [view, setView] = useState<View>("cumulative");
  const [byObjective, setByObjective] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  // ── URL-backed controls ────────────────────────────────────────────────────
  const setParams = (next: Record<string, string | null>) => {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    params.set("groupBy", groupBy);
    if (platforms.length > 0) params.set("platforms", platforms.join(","));
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    startNav(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  };
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

  // A platform filter scopes the spend side only; store revenue has no
  // attribution, so revenue and ROAS drop back to Spend rather than silently
  // mixing a filtered numerator with an unfiltered denominator.
  const platformFiltered = platforms.length > 0;
  const metricLocked = platformFiltered && metric !== "spend";
  const activeMetric: Metric = metricLocked ? "spend" : metric;

  // ── Series ─────────────────────────────────────────────────────────────────
  const seriesDefs: SeriesDef[] = useMemo(() => {
    if (!byObjective || activeMetric !== "spend") {
      return [
        {
          key: TOTAL_KEY,
          label: activeMetric === "revenue" ? "Revenue" : activeMetric === "roas" ? "ROAS" : "Spend",
          color: "var(--brand)",
        },
      ];
    }
    return BUDGET_OBJECTIVES.map((o, i) => ({
      key: o,
      label: o,
      color: seriesColor(i),
    }));
  }, [byObjective, activeMetric]);

  const shown = new Set(seriesDefs.filter((s) => !hidden.has(s.key)).map((s) => s.key));
  const toggleSeries = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ── Actual per day, scoped by the platform filter ──────────────────────────
  const inScope = (platform: string) =>
    platforms.length === 0 || platforms.includes(platform);

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
  const monthPlans: MonthPlan[] = useMemo(
    () =>
      plans.map((p) => ({
        month: p.month,
        // A platform filter scopes the PLAN too, so the comparison stays honest.
        plannedSpend: p.allocations
          .filter((a) => inScope(a.platform))
          .reduce((s, a) => s + a.plannedSpend, 0),
        plannedRevenueSar: p.plannedRevenueSar,
        dayWeights: p.dayWeights,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plans, platforms.join(",")],
  );

  const planSpendPerDay = useMemo(() => {
    if (!byObjective || activeMetric !== "spend") {
      return new Map([[TOTAL_KEY, stitchPlanByDay(monthPlans, (m) => m.plannedSpend)]]);
    }
    // One stitched curve per objective bucket, each from its own scoped total.
    const out = new Map<string, Map<string, number>>();
    out.set(TOTAL_KEY, stitchPlanByDay(monthPlans, (m) => m.plannedSpend));
    for (const objective of BUDGET_OBJECTIVES) {
      const scoped = plans.map((p) => ({
        month: p.month,
        plannedSpend: p.allocations
          .filter((a) => inScope(a.platform) && a.objective === objective)
          .reduce((s, a) => s + a.plannedSpend, 0),
        plannedRevenueSar: null,
        dayWeights: p.dayWeights,
      }));
      out.set(objective, stitchPlanByDay(scoped, (m) => m.plannedSpend));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthPlans, plans, byObjective, activeMetric, platforms.join(",")]);

  const planRevenuePerDay = useMemo(
    () => stitchPlanByDay(monthPlans, (m) => m.plannedRevenueSar),
    [monthPlans],
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

      for (const key of [TOTAL_KEY, ...BUDGET_OBJECTIVES]) {
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
  }, [buckets, spendPerDay, planSpendPerDay, revenuePerDay, planRevenuePerDay, horizon, storeHorizon]);

  // ── Chart ──────────────────────────────────────────────────────────────────
  const toDisplay = (usdAmount: number) => spendInDisplayCurrency(usdAmount, currency, rate);

  /** ROAS for a bucket: revenue ÷ (spend × rate), on either side of the plan. */
  const roasOf = (revenueSar: number, spendUsd: number) =>
    roasThroughRate(revenueSar, spendUsd, rate);

  const chartData = useMemo(
    () =>
      rows.map((r) => {
        const point: Record<string, string | number | null> = { label: r.bucket.label };
        if (activeMetric === "roas") {
          const actualRevenue = view === "cumulative" ? r.revenueCum : r.revenue;
          const actualSpend =
            view === "cumulative" ? (r.spendCum.get(TOTAL_KEY) ?? 0) : (r.spend.get(TOTAL_KEY) ?? 0);
          const planRevenue = view === "cumulative" ? r.planRevenueCum : r.planRevenue;
          const planSpend =
            view === "cumulative"
              ? (r.planSpendCum.get(TOTAL_KEY) ?? 0)
              : (r.planSpend.get(TOTAL_KEY) ?? 0);
          point[TOTAL_KEY] =
            r.spendUnknown || r.revenueUnknown ? null : roasOf(actualRevenue, actualSpend);
          point[`plan_${TOTAL_KEY}`] = roasOf(planRevenue, planSpend);
          return point;
        }
        if (activeMetric === "revenue") {
          point[TOTAL_KEY] = r.revenueUnknown ? null : view === "cumulative" ? r.revenueCum : r.revenue;
          const plan = view === "cumulative" ? r.planRevenueCum : r.planRevenue;
          point[`plan_${TOTAL_KEY}`] = plan > 0 ? plan : null;
          return point;
        }
        for (const def of seriesDefs) {
          const actual =
            view === "cumulative" ? r.spendCum.get(def.key) : r.spend.get(def.key);
          point[def.key] = r.spendUnknown ? null : toDisplay(actual ?? 0);
          const plan =
            view === "cumulative" ? r.planSpendCum.get(def.key) : r.planSpend.get(def.key);
          point[`plan_${def.key}`] = plan && plan > 0 ? toDisplay(plan) : null;
        }
        return point;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, seriesDefs, view, activeMetric, currency, rate],
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
      <span className="inline-flex items-center gap-1.5">
        <span className="num tabular-nums">{r.bucket.label}</span>
        {r.spendPartial && r.spendThrough && (
          <span className="text-label text-ink-3">through {monthDay(r.spendThrough)}</span>
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

    // Spend. One block per objective when the breakdown is on, else totals.
    const cols: DataColumn<BucketRow>[] = [periodCol];
    const blockKeys = byObjective ? [...BUDGET_OBJECTIVES, TOTAL_KEY] : [TOTAL_KEY];
    for (const key of blockKeys) {
      const isTotal = key === TOTAL_KEY;
      const name = isTotal ? "Total" : key;
      cols.push(
        {
          key: `${key}_actual`,
          label: byObjective ? `${name} actual` : `Spend (${currency})`,
          align: "right",
          render: (r) =>
            r.spendUnknown ? dash : (
              <span className={cn("num tabular-nums", isTotal && byObjective && "font-medium")}>
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
          label: byObjective
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
          label: byObjective ? `${name} pacing` : "Pacing",
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
  }, [activeMetric, byObjective, currency, rate, rows, groupBy, hasSpendPlan]);

  /** Why Revenue and ROAS are unavailable under a platform filter. */
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
      <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
        {/* Lifetime is hidden: an unbounded range has no plan to pace against,
            so the preset would silently do nothing. */}
        <DateRangePicker
          from={from}
          to={to}
          onChange={setRange}
          hidePresets={["lifetime"]}
        />

        <FilterPill
          icon={Layers}
          label="Platforms"
          value={platformFilterLabel}
          active={platformFiltered}
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

        <SegmentedControl<string>
          ariaLabel="Objective breakdown"
          value={byObjective ? "on" : "off"}
          onChange={(v) => setByObjective(v === "on")}
          options={[
            { value: "off", label: "Totals" },
            { value: "on", label: "By objective" },
          ]}
        />

        <div className="ml-auto flex items-center gap-2">
          <CurrencyToggle currency={currency} onChange={pickCurrency} />
        </div>

        {metricLocked && (
          <p className="w-full text-[11px] text-ink-3">
            Showing spend: store revenue isn&rsquo;t attributed to a platform (that
            lives on Reconciliation), so revenue and ROAS are all-platforms only.
          </p>
        )}
        {byObjective && activeMetric !== "spend" && (
          <p className="w-full text-[11px] text-ink-3">
            The objective breakdown applies to spend — revenue and ROAS have no
            objective split.
          </p>
        )}
      </div>

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
              Solid = actual · dashed = the plan, spread by each month&rsquo;s plan curve.
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
                    {
                      value: "revenue",
                      label: "Revenue",
                      disabled: platformFiltered,
                      title: allPlatformsOnly,
                    },
                    {
                      value: "roas",
                      label: "ROAS",
                      disabled: platformFiltered,
                      title: allPlatformsOnly,
                    },
                  ]}
                  value={activeMetric}
                  onChange={setMetric}
                />
              }
              controls={
                <>
                  <SegmentedControl<View>
                    ariaLabel="Chart view"
                    value={view}
                    onChange={setView}
                    options={[
                      { value: "cumulative", label: "Cumulative" },
                      { value: "period", label: "Per-period" },
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
                  {seriesDefs
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
                      view === "period" && activeMetric !== "roas" ? (
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
        rows={rows}
        rowKey={(r) => r.bucket.key}
        showTotals={rows.length > 0}
        minWidthClass={
          byObjective && activeMetric === "spend" ? "min-w-[1600px]" : "min-w-[720px]"
        }
        csvFileName={`budget-pacing-${from}-to-${to}-${groupBy}-${currency.toLowerCase()}`}
        rowClassName={(r) => cn(r.spendUnknown && "opacity-60")}
      />

      <HorizonNote horizon={horizon} storeHorizon={storeHorizon} />
    </div>
  );
}
