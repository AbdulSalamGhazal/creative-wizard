"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL, seriesColor } from "@/lib/palette";
import {
  monthDay,
  roas as fmtRoas,
  sar,
  sarCompact,
  signedPct,
  usdCompact,
} from "@/lib/format";
import { useNavTransition } from "@/lib/nav-progress";
import { cn } from "@/lib/utils";
import {
  curveExpected,
  dayBuckets,
  daysInMonth,
  elapsedDaysInMonth,
  monthKey,
  monthLabel,
  monthStartIso,
  pacingDeviation,
  pacingTone,
  pacingVerdict,
  roasThroughRate,
  spendInDisplayCurrency,
  variance,
  variancePct,
  weekBuckets,
  type MonthBucket,
} from "@/lib/budget";
import type {
  BudgetHistoryRow,
  BudgetMonthData,
  BudgetPacingSeries,
} from "@/db/queries/budget";
import {
  BudgetMonthBar,
  CurrencyToggle,
  HorizonNote,
  formatSpend,
  horizonDayInMonth,
  useBudgetCurrency,
} from "@/components/budget/budget-shared";
import { BudgetAllocationCheck } from "@/components/budget/budget-allocation-check";

export type Granularity = "daily" | "weekly" | "monthly";
type Dimension = "total" | "platform" | "objective";
type Metric = "spend" | "revenue";
type View = "cumulative" | "period";

/** How many months the cross-month view looks back. */
const MONTH_WINDOWS = [3, 6, 12] as const;
type MonthWindow = (typeof MONTH_WINDOWS)[number];

interface SeriesDef {
  key: string;
  label: string;
  color: string;
  /** The plan for THIS series over the whole month, USD (or SAR for revenue). */
  planned: number;
}

/** One bucket's folded numbers for ONE side (spend or revenue). */
interface BucketFold {
  bucket: MonthBucket;
  /** seriesKey → actual in the bucket (period) and through it (cumulative). */
  period: Map<string, number>;
  cumulative: Map<string, number>;
  /** Plan for the bucket / through the bucket, per series. */
  planPeriod: Map<string, number>;
  planCumulative: Map<string, number>;
  /** No data yet for any day in the bucket. */
  unknown: boolean;
  /** Some days known, some past the horizon — the sums are incomplete. */
  partial: boolean;
  /** Last known date in a partial bucket, for the "through …" note. */
  knownThrough: string | null;
}

/**
 * Fold a month's per-day values into buckets for one side. Spend and revenue
 * are folded SEPARATELY because they arrive on different upload schedules and
 * so have different horizons — a week can be complete for orders and still
 * missing its last ad day.
 */
function foldBuckets(
  buckets: MonthBucket[],
  defs: Array<{ key: string; planned: number }>,
  perDay: Map<string, Map<number, number>>,
  horizonDay: number,
  month: string,
  weights: Record<number, number>,
): BucketFold[] {
  const running = new Map<string, number>();
  return buckets.map((bucket) => {
    const period = new Map<string, number>();
    const cumulative = new Map<string, number>();
    const planPeriod = new Map<string, number>();
    const planCumulative = new Map<string, number>();

    const lastKnownDay = Math.min(bucket.endDay, horizonDay);
    const unknown = bucket.startDay > horizonDay;
    const partial = !unknown && bucket.endDay > horizonDay;

    for (const def of defs) {
      const days = perDay.get(def.key);
      let sum = 0;
      for (let d = bucket.startDay; d <= lastKnownDay; d++) sum += days?.get(d) ?? 0;
      period.set(def.key, sum);
      const next = (running.get(def.key) ?? 0) + sum;
      running.set(def.key, next);
      cumulative.set(def.key, next);

      // The plan is known for every day of the month — it doesn't stop at the
      // horizon — so plan-to-date runs to the bucket's real end.
      const throughEnd = curveExpected(def.planned, month, weights, bucket.endDay);
      const throughStart = curveExpected(def.planned, month, weights, bucket.startDay - 1);
      planCumulative.set(def.key, throughEnd);
      planPeriod.set(def.key, throughEnd - throughStart);
    }

    return {
      bucket,
      period,
      cumulative,
      planPeriod,
      planCumulative,
      unknown,
      partial,
      knownThrough:
        partial && lastKnownDay >= bucket.startDay
          ? `${monthStartIso(month).slice(0, 8)}${String(lastKnownDay).padStart(2, "0")}`
          : null,
    };
  });
}

/**
 * Budget Pacing — the module's plan-vs-actual surface, replacing the old Daily
 * and History pages (2026-09).
 *
 * Two questions, two sections. The allocation check answers "did the money go
 * where the plan put it" for the selected month; the time comparison answers
 * "are we on pace" at whatever resolution is useful — day, calendar week, or
 * across months. Spend is RAW (no exclusion filtering) and revenue is store
 * facts in SAR with no platform breakdown, both standing decisions; deviations
 * are warn-tinted by magnitude, never green/red; and a period past its side's
 * data horizon is UNKNOWN (em-dash), never zero.
 */
export function BudgetPacing({
  month,
  today,
  granularity,
  data,
  series,
  history,
  horizon,
  storeHorizon,
}: {
  month: string; // YYYY-MM
  today: string; // ISO date
  granularity: Granularity;
  data: BudgetMonthData;
  series: BudgetPacingSeries;
  history: BudgetHistoryRow[];
  horizon: string | null;
  storeHorizon: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startNav] = useNavTransition();

  const [currency, pickCurrency] = useBudgetCurrency();
  const rate = data.usdToSarRate;
  const fmtSpend = (usdAmount: number) => formatSpend(usdAmount, currency, rate);

  const [dimension, setDimension] = useState<Dimension>("total");
  const [platformPick, setPlatformPick] = useState<string>(ALL_PLATFORMS[0]);
  const [metric, setMetric] = useState<Metric>("spend");
  const [view, setView] = useState<View>("cumulative");
  const [monthsBack, setMonthsBack] = useState<MonthWindow>(6);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const isMonthly = granularity === "monthly";
  const isCurrentMonth = monthKey(today) === month;
  const totalDays = daysInMonth(monthStartIso(month));
  const elapsed = elapsedDaysInMonth(month, today);
  const weights = data.dayWeightOverrides;

  // Cross-month rows come from the month-grain history query, which has no
  // platform or objective breakdown at all.
  const dimensionLocked = isMonthly;
  const activeDimension: Dimension = dimensionLocked ? "total" : dimension;
  // Only Total has a revenue series to show — revenue is a store fact with no
  // platform attribution (that lives on Reconciliation), so a per-platform
  // revenue line would be an invention. Rather than hiding the option, the
  // metric drops back to Spend and the page says why. Judged on the ACTIVE
  // dimension, so a stale "By platform" pick doesn't explain itself in the
  // monthly view, where the dimension is moot anyway.
  const revenueLocked = activeDimension !== "total";
  const activeMetric: Metric = revenueLocked ? "spend" : metric;

  const setGranularity = (next: Granularity) =>
    startNav(() =>
      router.replace(
        `${pathname}?month=${month}&granularity=${next}`,
        { scroll: false },
      ),
    );

  // ── Series definitions ─────────────────────────────────────────────────────
  const plannedTotal = data.allocations.reduce((s, a) => s + a.plannedSpend, 0);

  /** The SPEND series for the active dimension. Revenue is its own single
   *  series (`revenueDef` below) — it has no dimension to slice by. */
  const spendDefs: SeriesDef[] = useMemo(() => {
    if (activeDimension === "total") {
      return [{ key: "total", label: "Spend", color: "var(--brand)", planned: plannedTotal }];
    }
    if (activeDimension === "platform") {
      const present = new Set<string>([
        ...data.allocations.map((a) => a.platform),
        ...series.spend.map((r) => r.platform),
      ]);
      return ALL_PLATFORMS.filter((p) => present.has(p)).map((p) => ({
        key: p,
        label: PLATFORM_LABEL[p],
        color: PLATFORM_COLOR[p],
        planned: data.allocations
          .filter((a) => a.platform === p)
          .reduce((s, a) => s + a.plannedSpend, 0),
      }));
    }
    // By objective, within the chosen platform.
    const present = new Set<string>([
      ...data.allocations.filter((a) => a.platform === platformPick).map((a) => a.objective),
      ...series.spend.filter((r) => r.platform === platformPick).map((r) => r.objective),
    ]);
    return [...present]
      .sort((a, b) => (a < b ? -1 : 1))
      .map((objective, i) => ({
        key: objective,
        label: objective,
        color: seriesColor(i),
        planned: data.allocations
          .filter((a) => a.platform === platformPick && a.objective === objective)
          .reduce((s, a) => s + a.plannedSpend, 0),
      }));
  }, [activeDimension, platformPick, data.allocations, series.spend, plannedTotal]);

  // ── Fold the month's raw rows into buckets ─────────────────────────────────
  const spendHorizonDay = horizonDayInMonth(month, horizon, totalDays);
  const revenueHorizonDay = horizonDayInMonth(month, storeHorizon, totalDays);

  /** seriesKey → day-of-month → SPEND, for the active dimension. */
  const perDaySpend = useMemo(() => {
    const out = new Map<string, Map<number, number>>();
    for (const r of series.spend) {
      if (activeDimension === "objective" && r.platform !== platformPick) continue;
      const key =
        activeDimension === "total"
          ? "total"
          : activeDimension === "platform"
            ? r.platform
            : r.objective;
      const day = Number(r.date.slice(8, 10));
      let days = out.get(key);
      if (!days) out.set(key, (days = new Map()));
      days.set(day, (days.get(day) ?? 0) + r.spend);
    }
    return out;
  }, [activeDimension, platformPick, series.spend]);

  /** Revenue is a single month-level series — no platform attribution here. */
  const perDayRevenue = useMemo(() => {
    const days = new Map<number, number>();
    for (const d of series.days) days.set(d.day, d.revenueSar);
    return new Map([["total", days]]);
  }, [series.days]);

  const buckets = useMemo(
    () => (granularity === "weekly" ? weekBuckets(month) : dayBuckets(month)),
    [granularity, month],
  );

  const revenueDef: SeriesDef = {
    key: "total",
    label: "Revenue",
    color: "var(--brand)",
    planned: data.plannedRevenueSar ?? 0,
  };

  // Both sides are folded every render, whatever the chart is showing: the
  // Total table shows spend columns AND revenue columns together, and each
  // side stops at its OWN horizon.
  const spendFold = useMemo(
    () => foldBuckets(buckets, spendDefs, perDaySpend, spendHorizonDay, month, weights),
    [buckets, spendDefs, perDaySpend, spendHorizonDay, month, weights],
  );
  const revenueFold = useMemo(
    () =>
      foldBuckets(buckets, [revenueDef], perDayRevenue, revenueHorizonDay, month, weights),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buckets, perDayRevenue, revenueHorizonDay, month, weights, data.plannedRevenueSar],
  );

  /** What the chart plots: the revenue fold in the revenue metric, else spend. */
  const chartDefs = activeMetric === "revenue" ? [revenueDef] : spendDefs;
  const chartFold = activeMetric === "revenue" ? revenueFold : spendFold;

  const shown = new Set(chartDefs.filter((s) => !hidden.has(s.key)).map((s) => s.key));
  const toggleSeries = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ── Cross-month rows ───────────────────────────────────────────────────────
  const monthlyRows = useMemo(() => {
    // `history` is newest-first; take the window, then read left-to-right.
    const window = history.slice(0, monthsBack).reverse();
    let cumActual = 0;
    let cumPlan = 0;
    return window.map((r) => {
      const actual = activeMetric === "revenue" ? r.actualRevenueSar : r.actualSpend;
      const plan =
        activeMetric === "revenue" ? (r.plannedRevenueSar ?? 0) : r.plannedSpend;
      cumActual += actual;
      cumPlan += plan;
      return { row: r, actual, plan, cumActual, cumPlan };
    });
  }, [history, monthsBack, activeMetric]);

  // ── Chart ──────────────────────────────────────────────────────────────────
  const toDisplay = (value: number) =>
    activeMetric === "revenue" ? value : spendInDisplayCurrency(value, currency, rate);

  const chartData = useMemo(() => {
    if (isMonthly) {
      return monthlyRows.map((m) => {
        const point: Record<string, string | number | null> = {
          label: monthLabel(m.row.month).replace(/ \d{4}$/, ""),
        };
        point.total = toDisplay(view === "cumulative" ? m.cumActual : m.actual);
        const plan = view === "cumulative" ? m.cumPlan : m.plan;
        point.plan_total = plan > 0 ? toDisplay(plan) : null;
        return point;
      });
    }
    return chartFold.map((b) => {
      const point: Record<string, string | number | null> = { label: b.bucket.label };
      for (const def of chartDefs) {
        const actual = view === "cumulative" ? b.cumulative.get(def.key) : b.period.get(def.key);
        // Past the horizon the line ENDS — an unknown period is not a zero.
        point[def.key] = b.unknown ? null : toDisplay(actual ?? 0);
        const plan =
          view === "cumulative" ? b.planCumulative.get(def.key) : b.planPeriod.get(def.key);
        point[`plan_${def.key}`] = def.planned > 0 ? toDisplay(plan ?? 0) : null;
      }
      return point;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMonthly, monthlyRows, chartFold, chartDefs, view, currency, rate, activeMetric]);

  const fmtValue = (v: number) =>
    activeMetric === "revenue" ? sar(v) : currency === "SAR" ? sar(v) : fmtSpend(v);
  const fmtAxis = (v: number) =>
    activeMetric === "revenue" || currency === "SAR" ? sarCompact(v) : usdCompact(v);

  const legendItems = chartDefs.map((s) => ({ key: s.key, label: s.label, color: s.color }));

  // ── Period table ───────────────────────────────────────────────────────────
  const dash = <span className="text-ink-3">—</span>;
  const devCell = (dev: number | null) => (
    <span className={cn("num text-xs", pacingTone(dev) === "warn" ? "text-warn" : "text-ink-3")}>
      {pacingVerdict(dev)}
    </span>
  );
  /** A variance %, warn-tinted by magnitude — the same threshold the rest of
   *  Budget pacing uses, never a second hard-coded 0.15. */
  const pctCell = (pct: number | null) => (
    <span
      className={cn(
        "num tabular-nums text-xs",
        pacingTone(pct) === "warn" ? "text-warn" : "text-ink-3",
      )}
    >
      {signedPct(pct)}
    </span>
  );

  /** Column totals for the cross-month table, summed once. */
  const monthlyTotals = useMemo(
    () => ({
      plannedSpend: monthlyRows.reduce((s, m) => s + m.row.plannedSpend, 0),
      reserve: monthlyRows.reduce((s, m) => s + m.row.reserveSpendUsd, 0),
      actualSpend: monthlyRows.reduce((s, m) => s + m.row.actualSpend, 0),
      plannedRevenue: monthlyRows.reduce((s, m) => s + (m.row.plannedRevenueSar ?? 0), 0),
      actualRevenue: monthlyRows.reduce((s, m) => s + m.row.actualRevenueSar, 0),
    }),
    [monthlyRows],
  );

  const monthlyColumns: DataColumn<(typeof monthlyRows)[number]>[] = useMemo(
    () => [
      {
        key: "month",
        label: "Month",
        pinned: true,
        href: (m) => `/budget?month=${m.row.month}`,
        render: (m) => (
          <span className="font-medium text-ink hover:underline">{monthLabel(m.row.month)}</span>
        ),
        csv: (m) => m.row.month,
        total: () => <span className="text-ink-3">Total</span>,
      },
      {
        key: "planned",
        label: `Planned (${currency})`,
        align: "right",
        render: (m) => (
          <span className="num tabular-nums">
            {m.row.plannedSpend > 0 ? fmtSpend(m.row.plannedSpend) : "—"}
            {m.row.reserveSpendUsd > 0 && (
              <span className="text-ink-3"> +{fmtSpend(m.row.reserveSpendUsd)}</span>
            )}
          </span>
        ),
        csv: (m) => spendInDisplayCurrency(m.row.plannedSpend, currency, rate).toFixed(2),
        total: () => (
          <span className="num tabular-nums font-semibold">
            {fmtSpend(monthlyTotals.plannedSpend)}
            {monthlyTotals.reserve > 0 && (
              <span className="text-ink-3"> +{fmtSpend(monthlyTotals.reserve)}</span>
            )}
          </span>
        ),
      },
      {
        key: "actual",
        label: `Actual (${currency})`,
        align: "right",
        render: (m) => <span className="num tabular-nums">{fmtSpend(m.row.actualSpend)}</span>,
        csv: (m) => spendInDisplayCurrency(m.row.actualSpend, currency, rate).toFixed(2),
        total: () => (
          <span className="num tabular-nums font-semibold">{fmtSpend(monthlyTotals.actualSpend)}</span>
        ),
      },
      {
        key: "variance",
        label: `Variance (${currency})`,
        align: "right",
        render: (m) => {
          const v = variance(m.row.actualSpend, m.row.plannedSpend);
          return (
            <span className="num tabular-nums text-ink-2">
              {v > 0 ? "+" : v < 0 ? "−" : ""}
              {fmtSpend(Math.abs(v))}
            </span>
          );
        },
        csv: (m) =>
          spendInDisplayCurrency(
            variance(m.row.actualSpend, m.row.plannedSpend),
            currency,
            rate,
          ).toFixed(2),
      },
      {
        key: "variance_pct",
        label: "Variance %",
        align: "right",
        render: (m) => pctCell(variancePct(m.row.actualSpend, m.row.plannedSpend)),
        csv: (m) => {
          const pct = variancePct(m.row.actualSpend, m.row.plannedSpend);
          return pct === null ? "" : (pct * 100).toFixed(1);
        },
        total: () => pctCell(variancePct(monthlyTotals.actualSpend, monthlyTotals.plannedSpend)),
      },
      {
        key: "planned_revenue",
        label: "Planned revenue (SAR)",
        align: "right",
        render: (m) => (
          <span className="num tabular-nums">
            {m.row.plannedRevenueSar !== null ? sar(m.row.plannedRevenueSar) : "—"}
          </span>
        ),
        csv: (m) => (m.row.plannedRevenueSar !== null ? m.row.plannedRevenueSar.toFixed(2) : ""),
        total: () => (
          <span className="num tabular-nums font-semibold">
            {monthlyTotals.plannedRevenue > 0 ? sar(monthlyTotals.plannedRevenue) : "—"}
          </span>
        ),
      },
      {
        key: "actual_revenue",
        label: "Actual revenue (SAR)",
        align: "right",
        render: (m) => <span className="num tabular-nums">{sar(m.row.actualRevenueSar)}</span>,
        csv: (m) => m.row.actualRevenueSar.toFixed(2),
        total: () => (
          <span className="num tabular-nums font-semibold">{sar(monthlyTotals.actualRevenue)}</span>
        ),
      },
      {
        key: "revenue_variance",
        label: "Revenue variance %",
        align: "right",
        render: (m) =>
          pctCell(
            m.row.plannedRevenueSar !== null
              ? variancePct(m.row.actualRevenueSar, m.row.plannedRevenueSar)
              : null,
          ),
        csv: (m) => {
          const pct =
            m.row.plannedRevenueSar !== null
              ? variancePct(m.row.actualRevenueSar, m.row.plannedRevenueSar)
              : null;
          return pct === null ? "" : (pct * 100).toFixed(1);
        },
        total: () =>
          pctCell(
            monthlyTotals.plannedRevenue > 0
              ? variancePct(monthlyTotals.actualRevenue, monthlyTotals.plannedRevenue)
              : null,
          ),
      },
      {
        key: "roas",
        label: "ROAS (via rate)",
        align: "right",
        render: (m) => {
          const v = roasThroughRate(m.row.actualRevenueSar, m.row.actualSpend, rate);
          return <span className="num tabular-nums">{v === null ? "—" : fmtRoas(v)}</span>;
        },
        csv: (m) => {
          const v = roasThroughRate(m.row.actualRevenueSar, m.row.actualSpend, rate);
          return v === null ? "" : v.toFixed(2);
        },
        total: () => {
          const v = roasThroughRate(
            monthlyTotals.actualRevenue,
            monthlyTotals.actualSpend,
            rate,
          );
          return (
            <span className="num tabular-nums font-semibold">
              {v === null ? "—" : fmtRoas(v)}
            </span>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency, rate, monthlyTotals],
  );

  /** The table walks the SPEND fold; the revenue columns index the revenue
   *  fold by position, since both folds share the same bucket list. */
  const revenueAt = (b: BucketFold) => revenueFold[spendFold.indexOf(b)];

  const bucketColumns: DataColumn<BucketFold>[] = useMemo(() => {
    const periodCol: DataColumn<BucketFold> = {
      key: "period",
      label: granularity === "weekly" ? "Week" : "Day",
      pinned: true,
      render: (b) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="num tabular-nums">{b.bucket.label}</span>
          {b.partial && b.knownThrough && (
            <span className="text-[10px] text-ink-3">through {monthDay(b.knownThrough)}</span>
          )}
        </span>
      ),
      csv: (b) => b.bucket.label,
      total: () => <span className="text-ink-3">Total</span>,
    };

    // Total dimension — the old Daily columns, per bucket.
    if (activeDimension === "total") {
      const key = "total";
      const lastKnown = spendFold.filter((b) => !b.unknown).at(-1);
      const cols: DataColumn<BucketFold>[] = [
        periodCol,
        {
          key: "spend",
          label: `Spend (${currency})`,
          align: "right",
          render: (b) =>
            b.unknown ? dash : (
              <span className="num tabular-nums">{fmtSpend(b.period.get(key) ?? 0)}</span>
            ),
          csv: (b) =>
            b.unknown
              ? ""
              : spendInDisplayCurrency(b.period.get(key) ?? 0, currency, rate).toFixed(2),
          total: () =>
            lastKnown ? (
              <span className="num tabular-nums font-semibold">
                {fmtSpend(lastKnown.cumulative.get(key) ?? 0)}
              </span>
            ) : (
              dash
            ),
        },
        {
          key: "cumulative",
          label: `Cumulative (${currency})`,
          align: "right",
          render: (b) =>
            b.unknown ? dash : (
              <span className="num tabular-nums">{fmtSpend(b.cumulative.get(key) ?? 0)}</span>
            ),
          csv: (b) =>
            b.unknown
              ? ""
              : spendInDisplayCurrency(b.cumulative.get(key) ?? 0, currency, rate).toFixed(2),
        },
        {
          key: "plan_to_date",
          label: `Plan-to-date (${currency})`,
          align: "right",
          render: (b) =>
            plannedTotal > 0 ? (
              <span className="num tabular-nums text-ink-3">
                {fmtSpend(b.planCumulative.get(key) ?? 0)}
              </span>
            ) : (
              dash
            ),
          csv: (b) =>
            plannedTotal > 0
              ? spendInDisplayCurrency(b.planCumulative.get(key) ?? 0, currency, rate).toFixed(2)
              : "",
          total: () =>
            plannedTotal > 0 ? (
              <span className="num tabular-nums font-semibold">{fmtSpend(plannedTotal)}</span>
            ) : (
              dash
            ),
        },
        {
          key: "deviation",
          label: "Deviation",
          align: "right",
          render: (b) =>
            b.unknown || plannedTotal === 0
              ? dash
              : devCell(
                  pacingDeviation(b.cumulative.get(key) ?? 0, b.planCumulative.get(key) ?? 0),
                ),
          csv: (b) =>
            b.unknown || plannedTotal === 0
              ? ""
              : pacingVerdict(
                  pacingDeviation(b.cumulative.get(key) ?? 0, b.planCumulative.get(key) ?? 0),
                ),
        },
      ];

      if (activeMetric === "revenue") {
        const target = data.plannedRevenueSar;
        cols.push(
          {
            key: "revenue",
            label: "Revenue (SAR)",
            align: "right",
            render: (b) => {
              const r = revenueAt(b);
              return !r || r.unknown ? dash : (
                <span className="num tabular-nums">{sar(r.period.get(key) ?? 0)}</span>
              );
            },
            csv: (b) => {
              const r = revenueAt(b);
              return !r || r.unknown ? "" : (r.period.get(key) ?? 0).toFixed(2);
            },
          },
          {
            key: "cum_revenue",
            label: "Cumulative (SAR)",
            align: "right",
            render: (b) => {
              const r = revenueAt(b);
              return !r || r.unknown ? dash : (
                <span className="num tabular-nums">{sar(r.cumulative.get(key) ?? 0)}</span>
              );
            },
            csv: (b) => {
              const r = revenueAt(b);
              return !r || r.unknown ? "" : (r.cumulative.get(key) ?? 0).toFixed(2);
            },
          },
          {
            key: "target_to_date",
            label: "Target-to-date (SAR)",
            align: "right",
            render: (b) => {
              const r = revenueAt(b);
              return target !== null && r ? (
                <span className="num tabular-nums text-ink-3">
                  {sar(r.planCumulative.get(key) ?? 0)}
                </span>
              ) : (
                dash
              );
            },
            csv: (b) => {
              const r = revenueAt(b);
              return target !== null && r ? (r.planCumulative.get(key) ?? 0).toFixed(2) : "";
            },
          },
          {
            key: "revenue_dev",
            label: "Revenue deviation",
            align: "right",
            render: (b) => {
              const r = revenueAt(b);
              if (!r || r.unknown || target === null) return dash;
              return devCell(
                pacingDeviation(r.cumulative.get(key) ?? 0, r.planCumulative.get(key) ?? 0),
              );
            },
            csv: (b) => {
              const r = revenueAt(b);
              if (!r || r.unknown || target === null) return "";
              return pacingVerdict(
                pacingDeviation(r.cumulative.get(key) ?? 0, r.planCumulative.get(key) ?? 0),
              );
            },
          },
        );
      }
      return cols;
    }

    // By platform / by objective — a pivot: one actual column per series.
    const pivot: DataColumn<BucketFold>[] = [periodCol];
    for (const def of spendDefs) {
      pivot.push({
        key: `s_${def.key}`,
        label: def.label,
        align: "right",
        render: (b) =>
          b.unknown ? dash : (
            <span className="num tabular-nums">{fmtSpend(b.period.get(def.key) ?? 0)}</span>
          ),
        csv: (b) =>
          b.unknown
            ? ""
            : spendInDisplayCurrency(b.period.get(def.key) ?? 0, currency, rate).toFixed(2),
      });
    }
    const sumOf = (pick: (k: string) => number) =>
      spendDefs.reduce((s, def) => s + pick(def.key), 0);
    pivot.push(
      {
        key: "row_total",
        label: `Total (${currency})`,
        align: "right",
        render: (b) =>
          b.unknown ? dash : (
            <span className="num tabular-nums font-medium">
              {fmtSpend(sumOf((k) => b.period.get(k) ?? 0))}
            </span>
          ),
        csv: (b) =>
          b.unknown
            ? ""
            : spendInDisplayCurrency(
                sumOf((k) => b.period.get(k) ?? 0),
                currency,
                rate,
              ).toFixed(2),
      },
      {
        key: "plan_to_date",
        label: `Plan-to-date (${currency})`,
        align: "right",
        render: (b) => (
          <span className="num tabular-nums text-ink-3">
            {fmtSpend(sumOf((k) => b.planCumulative.get(k) ?? 0))}
          </span>
        ),
        csv: (b) =>
          spendInDisplayCurrency(
            sumOf((k) => b.planCumulative.get(k) ?? 0),
            currency,
            rate,
          ).toFixed(2),
      },
      {
        key: "deviation",
        label: "Deviation",
        align: "right",
        render: (b) =>
          b.unknown
            ? dash
            : devCell(
                pacingDeviation(
                  sumOf((k) => b.cumulative.get(k) ?? 0),
                  sumOf((k) => b.planCumulative.get(k) ?? 0),
                ),
              ),
        csv: (b) =>
          b.unknown
            ? ""
            : pacingVerdict(
                pacingDeviation(
                  sumOf((k) => b.cumulative.get(k) ?? 0),
                  sumOf((k) => b.planCumulative.get(k) ?? 0),
                ),
              ),
      },
    );
    return pivot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeDimension,
    activeMetric,
    spendDefs,
    spendFold,
    revenueFold,
    currency,
    rate,
    plannedTotal,
    granularity,
    data.plannedRevenueSar,
  ]);

  const chartTitle = isMonthly
    ? `Last ${monthsBack} months`
    : `${granularity === "weekly" ? "Weekly" : "Daily"} — ${monthLabel(month)}`;

  return (
    <div className="space-y-4">
      <BudgetMonthBar month={month} today={today}>
        <CurrencyToggle currency={currency} onChange={pickCurrency} />
      </BudgetMonthBar>

      {/* ── Section 1 — allocation check ─────────────────────────────────── */}
      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-medium text-ink">Allocation check</h2>
          <p className="text-[11px] text-ink-3">
            Where {monthLabel(month)}&rsquo;s money actually went, against the plan.
            Combos with spend but no allocation show as unplanned — the reserve&rsquo;s
            territory.
          </p>
        </div>
        <BudgetAllocationCheck
          month={month}
          data={data}
          currency={currency}
          elapsedDays={elapsed}
          isCurrentMonth={isCurrentMonth}
        />
      </section>

      {/* ── Section 2 — time comparison ──────────────────────────────────── */}
      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-medium text-ink">Time comparison</h2>
          <p className="text-[11px] text-ink-3">
            Actual against the plan curve over time. Periods past the data horizon are
            unknown, not zero.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2">
          <span className="text-label text-ink-3">Granularity</span>
          <SegmentedControl<Granularity>
            ariaLabel="Granularity"
            value={granularity}
            onChange={setGranularity}
            options={[
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
              { value: "monthly", label: "Monthly" },
            ]}
          />

          {isMonthly ? (
            <>
              <span className="text-label text-ink-3">Range</span>
              <SegmentedControl<string>
                ariaLabel="Months shown"
                value={String(monthsBack)}
                onChange={(v) => setMonthsBack(Number(v) as MonthWindow)}
                options={MONTH_WINDOWS.map((n) => ({
                  value: String(n),
                  label: `${n}m`,
                }))}
              />
            </>
          ) : (
            <>
              <span className="text-label text-ink-3">Dimension</span>
              <Select value={dimension} onValueChange={(v) => setDimension(v as Dimension)}>
                <SelectTrigger className="h-8 w-[9.5rem]" aria-label="Dimension">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="total">Total</SelectItem>
                  <SelectItem value="platform">By platform</SelectItem>
                  <SelectItem value="objective">By objective</SelectItem>
                </SelectContent>
              </Select>
              {dimension === "objective" && (
                <Select value={platformPick} onValueChange={setPlatformPick}>
                  <SelectTrigger className="h-8 w-[8.5rem]" aria-label="Platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PLATFORM_LABEL[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          )}

          {dimensionLocked && (
            <span className="text-[11px] text-ink-3">
              Monthly rows come from month totals, so the platform and objective
              breakdowns aren&rsquo;t available here — switch to Daily or Weekly for those.
            </span>
          )}
          {revenueLocked && (
            <span className="text-[11px] text-ink-3">
              Showing spend: revenue is a store total with no platform attribution
              (that lives on Reconciliation), so it only has a Total view.
            </span>
          )}
        </div>

        {/* Chart */}
        <ChartShell
          ariaLabel="Budget pacing — expanded"
          legend={
            chartDefs.length > 1 ? (
              <SeriesLegend
                items={legendItems}
                shown={shown}
                onToggle={toggleSeries}
                onShowAll={() => setHidden(new Set())}
              />
            ) : undefined
          }
        >
          {({ inFull, toggleExpand }) => (
            <div className={inFull ? "flex flex-col h-full" : undefined}>
              <ChartHeader
                title={chartTitle}
                picker={
                  <MetricPicker<Metric>
                    options={[
                      { value: "spend", label: "Spend" },
                      { value: "revenue", label: "Revenue" },
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
                      minTickGap={12}
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
                              const def = chartDefs.find(
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
                    {chartDefs
                      .filter((def) => shown.has(def.key))
                      .flatMap((def) => [
                        <Line
                          key={`plan_${def.key}`}
                          type="linear"
                          dataKey={`plan_${def.key}`}
                          stroke={chartDefs.length > 1 ? def.color : "var(--ink-3)"}
                          strokeWidth={1.4}
                          strokeDasharray="5 4"
                          strokeOpacity={chartDefs.length > 1 ? 0.55 : 1}
                          dot={false}
                          activeDot={{ r: 3 }}
                          connectNulls={false}
                          isAnimationActive={false}
                        />,
                        view === "period" ? (
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
        {isMonthly ? (
          <DataTable
            columns={monthlyColumns}
            rows={monthlyRows}
            rowKey={(m) => m.row.month}
            showTotals={monthlyRows.length > 0}
            minWidthClass="min-w-[1040px]"
            csvFileName={`budget-pacing-monthly-${currency.toLowerCase()}`}
            empty={
              <div className="py-12 text-center text-sm text-ink-2">
                No budget months yet.
              </div>
            }
          />
        ) : (
          <DataTable<BucketFold>
            columns={bucketColumns}
            rows={spendFold}
            rowKey={(b) => b.bucket.key}
            showTotals={spendFold.length > 0}
            minWidthClass={activeDimension === "total" ? "min-w-[720px]" : "min-w-[620px]"}
            csvFileName={`budget-pacing-${granularity}-${month}-${currency.toLowerCase()}`}
            rowClassName={(b) => cn(b.unknown && "opacity-60")}
          />
        )}
      </section>

      <HorizonNote horizon={horizon} storeHorizon={storeHorizon} />
    </div>
  );
}
