"use client";

import { useMemo, useState } from "react";
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
import { Coins, Download, PiggyBank, Receipt, RotateCcw, ShoppingBag, Undo2 } from "lucide-react";
import Link from "@/components/nav/link";
import { CompareToggle } from "@/components/filters/filter-pill";
import { StoreInsightsSections } from "@/components/store/store-insights-sections";
import { addDays, computeDelta, dayCount, deltaVsLabel } from "@/lib/period";
import type {
  StoreInsightsKpis,
  StoreInsightsProducts,
  StoreInsightsSections as SectionsData,
} from "@/db/queries/store-insights";
import { grossProfit, rate, type ProductTotals } from "@/lib/store-insights";
import { ChartHeader, ChartShell, ExpandButton, plotClass } from "@/components/charts/chart-shell";
import { CHART_CURSOR, ChartTooltip, CHART_STROKE } from "@/components/charts/chart-tooltip";
import { SeriesLegend } from "@/components/charts/series-legend";
import { MetricPicker } from "@/components/charts/metric-picker";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { cn } from "@/lib/utils";
import { MetricCard } from "@/components/overview/metric-card";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { FilterShell } from "@/components/filters/filter-shell";
import { useFilterParams } from "@/components/filters/use-filter-params";
import type { FilterDef } from "@/components/filters/filter-model";
import type { DateRangeValue } from "@/lib/date-presets";
import {
  dayBucketsInRange,
  monthBucketsInRange,
  weekBucketsInRange,
  type RangeBucket,
} from "@/lib/budget";
import { int, intCompact, num, pct1, sar, sar0, sarCompact, sarBare } from "@/lib/format";
import { downloadCsv, matrixToCsv, todayStamp } from "@/lib/csv-export";
import { PLATFORM_LABEL, seriesColor } from "@/lib/palette";
import { platformEnum } from "@/lib/enums";
import { CHANNEL_DESTINATIONS, CHANNEL_LABEL, UNMAPPED_CHANNEL } from "@/store/channels";
import { UNATTRIBUTED } from "@/store/sources";
import {
  OTHER_VALUE,
  aov,
  foldTopValues,
  share,
  valueLabel,
  dimensionNoun,
  TOP_VALUE_LIMIT,
  type InsightDimension,
} from "@/lib/store-insights";
import type { StoreInsightsDay } from "@/db/queries/store-insights";
import type { BreakdownValue } from "@/lib/store-insights";
import { EmptyState } from "@/components/ui/empty-state";
import { panelClass } from "@/components/ui/panel";

type GroupBy = "day" | "week" | "month";

/** The two series share an x-axis but not a scale — orders are counts, revenue is SAR. */
const ORDERS_COLOR = seriesColor(0);
const REVENUE_COLOR = seriesColor(2);
const ALL_SERIES = ["orders", "revenue", "prevOrders", "prevRevenue"] as const;
/** The analyzer's optional columns — offered, collapsed on a first visit. */
const INSIGHTS_DEFAULT_HIDDEN = ["firstOrder", "lastOrder"] as const;

interface TrendPoint {
  key: string;
  label: string;
  orders: number;
  revenue: number;
  /** The previous window's figures, day-aligned — only with `?compare=1`. */
  prevOrders?: number;
  prevRevenue?: number;
}

/** The previous window, as the server scanned it (`?compare=1`). */
export interface InsightsComparison {
  range: { from: string; to: string };
  daily: StoreInsightsDay[];
  kpis: StoreInsightsKpis;
  productTotals: ProductTotals;
}

/** Roll the per-day rows into the chosen buckets — the range-clipped helpers
 *  the Pacing chart already uses, never a second week/month definition. */
function bucketize(
  daily: readonly StoreInsightsDay[],
  buckets: readonly RangeBucket[],
): TrendPoint[] {
  return buckets.map((b) => {
    let orders = 0;
    let revenue = 0;
    for (const d of daily) {
      if (d.day >= b.start && d.day <= b.end) {
        orders += d.orders;
        revenue += d.revenue;
      }
    }
    return { key: b.key, label: b.label, orders, revenue };
  });
}

interface AnalyzerRow extends BreakdownValue {
  foldedCount: number;
  label: string;
  ordersShare: number | null;
  revenueShare: number | null;
  aov: number | null;
}

/**
 * Store Insights — the whole client surface: the filter bar, the KPI row, the
 * trend, and the analyzer.
 *
 * STORE FACTS ONLY, SAR ONLY (standing decision): every figure here comes from
 * `store_orders`. The previous-period comparison is a toggle, OFF by default
 * (user decision 2026-11-27): only when it is on do tiles carry a delta and
 * the trend a dashed previous line.
 */
export function StoreInsightsView({
  from,
  to,
  resolvedRange,
  resolvedFilters,
  dimensions,
  dimension,
  daily,
  breakdown,
  totalValues,
  kpis,
  sections,
  products,
  compare,
}: {
  /** Raw URL range (drives the highlighted preset), null when absent. */
  from: string | null;
  to: string | null;
  /** What the scans actually ran — the picker's label falls back to it. */
  resolvedRange: DateRangeValue;
  /** Remembered filters as the server resolved them (0049). */
  resolvedFilters: Record<string, string | undefined>;
  dimensions: InsightDimension[];
  /** The resolved dimension — null only when the brand has no usable field. */
  dimension: InsightDimension | null;
  daily: StoreInsightsDay[];
  breakdown: BreakdownValue[];
  /** Distinct values in range before the query's group cap. */
  totalValues: number;
  kpis: StoreInsightsKpis;
  sections: SectionsData;
  products: StoreInsightsProducts;
  /** The previous window — null unless the comparison toggle is on. */
  compare: InsightsComparison | null;
}) {
  const { update, get } = useFilterParams(resolvedFilters);

  // Bucketing is a VIEW control, not a filter: client state, like
  // Reconciliation's mode toggle. It re-buckets the rows already on the page,
  // so it never costs a navigation or a scan.
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  // The two "before" series are keyed in from the start: they only have a
  // legend chip (and a line) while the comparison is on.
  const [shown, setShown] = useState<Set<string>>(() => new Set(ALL_SERIES));

  const csv = (v: string | null): string[] =>
    v ? v.split(",").filter(Boolean) : [];
  const platforms = csv(get("platforms"));
  const channels = csv(get("channels"));

  const writeMulti = (key: string, values: readonly string[]) =>
    update((next) => {
      if (values.length === 0) next.delete(key);
      else next.set(key, values.join(","));
    });

  // ── Range totals ───────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const orders = daily.reduce((a, d) => a + d.orders, 0);
    const revenue = daily.reduce((a, d) => a + d.revenue, 0);
    return { orders, revenue };
  }, [daily]);
  const rangeDays = useMemo(
    () => dayBucketsInRange(resolvedRange.from, resolvedRange.to).length,
    [resolvedRange.from, resolvedRange.to],
  );
  const empty = totals.orders === 0;

  // ── Trend ──────────────────────────────────────────────────────────────────
  const points = useMemo(() => {
    const buckets =
      groupBy === "day"
        ? dayBucketsInRange(resolvedRange.from, resolvedRange.to)
        : groupBy === "week"
          ? weekBucketsInRange(resolvedRange.from, resolvedRange.to)
          : monthBucketsInRange(resolvedRange.from, resolvedRange.to);
    const current = bucketize(daily, buckets);
    if (!compare) return current;
    // The previous window is the same length, so shifting its days forward
    // by that length lays day 1 over day 1 — then the SAME buckets apply.
    const len = dayCount(resolvedRange.from, resolvedRange.to);
    const shifted = compare.daily.map((d) => ({ ...d, day: addDays(d.day, len) }));
    const previous = bucketize(shifted, buckets);
    return current.map((p, i) => ({
      ...p,
      prevOrders: previous[i]!.orders,
      prevRevenue: previous[i]!.revenue,
    }));
  }, [daily, groupBy, resolvedRange.from, resolvedRange.to, compare]);

  /** What the legend sees: the "before" keys only while they have chips. */
  const legendShown = useMemo(
    () => new Set([...shown].filter((k) => compare !== null || !k.startsWith("prev"))),
    [shown, compare],
  );

  // ── KPI tiles, and their previous-window twins ─────────────────────────────
  const gp = grossProfit(products.total);
  const lostRate = rate(kpis.cancelled + kpis.refunded, kpis.orders);
  const knownCustomers = kpis.newOrders + kpis.returningOrders;
  const returningShare = rate(kpis.returningOrders, knownCustomers);
  const prevFigures = useMemo(() => {
    if (!compare) return null;
    const k = compare.kpis;
    return {
      orders: k.orders,
      revenue: k.revenue,
      aov: aov(k.revenue, k.orders),
      profit: grossProfit(compare.productTotals).profit,
      lostRate: rate(k.cancelled + k.refunded, k.orders),
      returningShare: rate(k.returningOrders, k.newOrders + k.returningOrders),
    };
  }, [compare]);
  /** A tile's delta and its "vs …" text — only when comparing, never on an empty range. */
  const vs = (current: number | null, previous: number | null | undefined, format: (n: number | null) => string) =>
    prevFigures && !empty
      ? {
          delta: computeDelta(current, previous ?? null),
          deltaVs: deltaVsLabel(resolvedRange.from, resolvedRange.to, format(previous ?? null)),
        }
      : {};
  /** A rate's previous value, in points — a % change of a % reads two ways. */
  const ratePrev = (previous: number | null | undefined) =>
    prevFigures && !empty ? (
      <span className="tabular-nums">{pct1(previous ?? null)} before</span>
    ) : undefined;

  // ── Analyzer ───────────────────────────────────────────────────────────────
  // The tail past TOP_VALUE_LIMIT folds into one "Other" row so a long-tail
  // dimension stays readable; the fold keeps the tail's orders and revenue, so
  // the column totals still reconcile with the range.
  const folded = useMemo(
    () =>
      foldTopValues(breakdown, undefined, {
        orders: totals.orders,
        revenue: totals.revenue,
        values: totalValues,
      }),
    [breakdown, totals.orders, totals.revenue, totalValues],
  );
  const rows = useMemo((): AnalyzerRow[] => {
    if (!dimension) return [];
    return folded.map((r) => ({
      ...r,
      label: valueLabel(r.value, dimension, r.foldedCount),
      ordersShare: share(r.orders, totals.orders),
      revenueShare: share(r.revenue, totals.revenue),
      aov: aov(r.revenue, r.orders),
    }));
  }, [folded, dimension, totals.orders, totals.revenue]);
  const foldedRow = folded.find((r) => r.value === OTHER_VALUE);

  const columns = useMemo((): DataColumn<AnalyzerRow>[] => {
    if (!dimension) return [];
    /**
     * "Other" is a SUMMARY of the values not shown, not a value — so it sinks
     * to the bottom whatever the table is sorted by, via the primitive's own
     * rule that a null sort value sinks in BOTH directions. Sorted on its
     * aggregate it would sit above real values that each have fewer orders,
     * reading like one enormous source.
     */
    const sortOf = <V,>(r: AnalyzerRow, value: V) =>
      r.value === OTHER_VALUE ? null : value;
    return [
      {
        key: "value",
        label: dimension.label,
        pinned: true,
        sortable: true,
        sortValue: (r) => sortOf(r, r.label),
        defaultSortDir: "asc",
        csv: (r) => r.label,
        render: (r) => (
          <span
            dir="auto"
            className={cn(
              // A dimension VALUE is free text (a UTM string, a city, any
              // custom field) — it needs something to truncate against, and
              // the phone cap keeps this pinned cell inside the frame.
              "block max-w-[12rem] truncate sm:max-w-none",
              r.value === null || r.value === OTHER_VALUE ? "text-ink-2" : "text-ink",
            )}
            title={r.label}
          >
            {r.label}
          </span>
        ),
      },
      {
        key: "orders",
        label: "Orders",
        align: "right",
        sortable: true,
        sortValue: (r) => sortOf(r, r.orders),
        render: (r) => <span className="tabular-nums">{int(r.orders)}</span>,
        total: () => <span className="tabular-nums">{int(totals.orders)}</span>,
      },
      {
        key: "ordersShare",
        label: "% of orders",
        align: "right",
        sortable: true,
        sortValue: (r) => sortOf(r, r.ordersShare),
        csv: (r) => (r.ordersShare === null ? null : r.ordersShare),
        render: (r) => (
          // The share bar reads at a glance and the number stays exact — the
          // Tracker's bar, without its plan tick (there is no plan here).
          <div className="flex items-center justify-end gap-2">
            <span
              className="relative h-1.5 w-16 shrink-0 rounded-full bg-surface-2"
              aria-hidden
            >
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-brand"
                style={{ width: `${Math.min(100, (r.ordersShare ?? 0) * 100)}%` }}
              />
            </span>
            <span className="tabular-nums w-12">{pct1(r.ordersShare)}</span>
          </div>
        ),
        total: () => (
          <span className="tabular-nums">{empty ? "—" : pct1(1)}</span>
        ),
      },
      {
        key: "revenue",
        label: "Revenue (SAR)",
        align: "right",
        sortable: true,
        sortValue: (r) => sortOf(r, r.revenue),
        render: (r) => <span className="tabular-nums">{sarBare(r.revenue)}</span>,
        total: () => <span className="tabular-nums">{sarBare(totals.revenue)}</span>,
      },
      {
        key: "revenueShare",
        label: "% of revenue",
        align: "right",
        sortable: true,
        sortValue: (r) => sortOf(r, r.revenueShare),
        csv: (r) => (r.revenueShare === null ? null : r.revenueShare),
        render: (r) => <span className="tabular-nums">{pct1(r.revenueShare)}</span>,
        total: () => (
          <span className="tabular-nums">{empty ? "—" : pct1(1)}</span>
        ),
      },
      {
        key: "aov",
        label: "AOV",
        align: "right",
        sortable: true,
        sortValue: (r) => sortOf(r, r.aov),
        render: (r) => (
          <span className="tabular-nums">{r.aov === null ? "—" : sar(r.aov)}</span>
        ),
        total: () => (
          <span className="tabular-nums">
            {aov(totals.revenue, totals.orders) === null
              ? "—"
              : sar(aov(totals.revenue, totals.orders)!)}
          </span>
        ),
      },
      // ── Optional (defaultHidden): the same GROUP BY's MIN/MAX. ──
      {
        key: "firstOrder",
        label: "First order",
        sortable: true,
        sortValue: (r) => sortOf(r, r.firstOrder ?? null),
        csv: (r) => r.firstOrder ?? null,
        render: (r) => <span className="tabular-nums">{r.firstOrder ?? "—"}</span>,
      },
      {
        key: "lastOrder",
        label: "Last order",
        sortable: true,
        sortValue: (r) => sortOf(r, r.lastOrder ?? null),
        csv: (r) => r.lastOrder ?? null,
        render: (r) => <span className="tabular-nums">{r.lastOrder ?? "—"}</span>,
      },
    ];
  }, [dimension, totals.orders, totals.revenue, empty]);
  // The table's own columns control, remembered per user per brand.
  const columnKeys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.STORE_INSIGHTS,
    hideable: columnKeys,
    defaults: columnKeys,
    defaultHidden: INSIGHTS_DEFAULT_HIDDEN,
  });


  /**
   * CSV exports the FULL breakdown — every value the range scan returned, not
   * the folded top-N on screen. The fold is a reading aid; an export is data.
   */
  const exportCsv = () => {
    if (!dimension) return;
    const sorted = [...breakdown].sort((a, b) => b.orders - a.orders);
    const head = [
      dimension.label,
      "Orders",
      "% of orders",
      "Revenue (SAR)",
      "% of revenue",
      "AOV",
      "First order",
      "Last order",
    ];
    const rows = sorted.map((r): Array<string | number> => {
      const os = share(r.orders, totals.orders);
      const rs = share(r.revenue, totals.revenue);
      const a = aov(r.revenue, r.orders);
      return [
        valueLabel(r.value, dimension),
        r.orders,
        os === null ? "" : os,
        r.revenue,
        rs === null ? "" : rs,
        a === null ? "" : a,
        r.firstOrder ?? "",
        r.lastOrder ?? "",
      ];
    });
    const slug = dimension.key.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    downloadCsv(`store-insights-${slug}-${todayStamp()}.csv`, matrixToCsv(head, rows));
  };

  // ── Filters ────────────────────────────────────────────────────────────────
  // Two defs, both STANDARD — so they are remembered per user per brand like
  // any other filter (0049), and they share the `platforms` key with every
  // other page that has it.
  const filters: FilterDef[] = [
    {
      key: "platforms",
      label: "Platform",
      type: "multi",
      options: [
        ...platformEnum.map((p) => ({ value: p, label: PLATFORM_LABEL[p] })),
        // The bucket, not a platform — an order whose source nobody mapped.
        { value: UNATTRIBUTED, label: "Unattributed" },
      ],
      values: platforms,
      onChange: (next) => writeMulti("platforms", next),
    },
    {
      key: "channels",
      label: "Channel",
      type: "multi",
      options: [
        ...CHANNEL_DESTINATIONS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] })),
        { value: UNMAPPED_CHANNEL, label: "Unmapped" },
      ],
      values: channels,
      onChange: (next) => writeMulti("channels", next),
    },
  ];

  return (
    <div className="space-y-4">
      <FilterShell
        filters={filters}
        // `by` is a page-owned control (it sits with the analyzer, not in the
        // bar) but it IS a remembered choice — declared here so the one writer
        // knows it may be persisted.
        persistKeys={["by"]}
        tier1={({ fullWidth }) => (
          <DateRangePicker
            from={from}
            to={to}
            onChange={(nf, nt) =>
              update((p) => {
                if (nf) p.set("from", nf);
                else p.delete("from");
                if (nt) p.set("to", nt);
                else p.delete("to");
              })
            }
            remember
            fullWidth={fullWidth}
            fallback={resolvedRange}
          />
        )}
        // The right-hand cluster, where the Excluded toggle sits on the ads
        // pages: a view switch beside the filters, never one of them.
        toolbar={({ fullWidth }) => (
          <CompareToggle
            on={compare !== null}
            fullWidth={fullWidth}
            onToggle={() =>
              update((p) => {
                if (compare) p.delete("compare");
                else p.set("compare", "1");
              })
            }
          />
        )}
      />

      {/* KPIs — deltas only while the comparison toggle is on. */}
      <div className="grid grid-cols-2 gap-3 @3xl/main:grid-cols-3 @6xl/main:grid-cols-6">
        <MetricCard
          label="Orders"
          value={empty ? "—" : int(totals.orders)}
          icon={ShoppingBag}
          hideBreakdown
          empty={empty}
          {...vs(totals.orders, prevFigures?.orders, int)}
          caption={
            empty || rangeDays === 0 ? undefined : (
              <span className="tabular-nums">
                {num(Math.round((totals.orders / rangeDays) * 10) / 10)} a day
              </span>
            )
          }
        />
        <MetricCard
          label="Revenue"
          value={empty ? "—" : sar0(totals.revenue)}
          valueTitle={empty ? undefined : sar(totals.revenue)}
          icon={Coins}
          hideBreakdown
          empty={empty}
          {...vs(totals.revenue, prevFigures?.revenue, sar0)}
        />
        <MetricCard
          label="AOV"
          value={sar0(aov(totals.revenue, totals.orders))}
          icon={Receipt}
          hideBreakdown
          empty={empty}
          {...vs(aov(totals.revenue, totals.orders), prevFigures?.aov, sar0)}
        />
        <MetricCard
          label="Gross profit"
          value={empty ? "—" : sar0(gp.profit)}
          icon={PiggyBank}
          hideBreakdown
          empty={empty}
          {...(gp.profit === null ? {} : vs(gp.profit, prevFigures?.profit, sar0))}
          caption={
            empty ? undefined : gp.margin === null ? (
              <Link href="/store/costs" className="text-brand hover:underline">
                Add product costs
              </Link>
            ) : (
              <span className="tabular-nums" title="Gross profit ÷ sales before VAT, on costed products">
                {pct1(gp.margin)} margin
              </span>
            )
          }
        />
        <MetricCard
          label="Cancelled or refunded"
          value={pct1(lostRate)}
          icon={Undo2}
          hideBreakdown
          empty={empty}
          caption={
            ratePrev(prevFigures?.lostRate) ??
            (empty ? undefined : (
              <span className="tabular-nums">{int(kpis.cancelled + kpis.refunded)} orders</span>
            ))
          }
        />
        <MetricCard
          label="Returning"
          value={pct1(returningShare)}
          icon={RotateCcw}
          hideBreakdown
          empty={empty}
          caption={
            ratePrev(prevFigures?.returningShare) ??
            (empty ? undefined : (
              <span className="tabular-nums">{int(kpis.returningOrders)} orders</span>
            ))
          }
        />
      </div>

      {/* Trend */}
      <ChartShell
        ariaLabel="Orders and revenue over the range" summary="Orders and revenue (SAR) per day over the range"
        legend={
          <SeriesLegend
            items={[
              { key: "orders", label: "Orders", color: ORDERS_COLOR },
              { key: "revenue", label: "Revenue (SAR)", color: REVENUE_COLOR },
              ...(compare
                ? [
                    { key: "prevOrders", label: "Orders before", color: ORDERS_COLOR },
                    { key: "prevRevenue", label: "Revenue before", color: REVENUE_COLOR },
                  ]
                : []),
            ]}
            shown={legendShown}
            onToggle={(key) =>
              setShown((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            onShowAll={() => setShown(new Set(ALL_SERIES))}
          />
        }
      >
        {({ inFull, toggleExpand }) => (
          <div className={inFull ? "flex h-full flex-col" : undefined}>
            <ChartHeader
              title="Orders and revenue"
              controls={
                <>
                  <SegmentedControl<GroupBy>
                    ariaLabel="Group by"
                    value={groupBy}
                    onChange={setGroupBy}
                    options={[
                      { value: "day", label: "Day" },
                      { value: "week", label: "Week" },
                      { value: "month", label: "Month" },
                    ]}
                  />
                  <ExpandButton inFull={inFull} onClick={toggleExpand} />
                </>
              }
            />
            <div className={plotClass(inFull, "md")}>
              {empty ? (
                <div className="flex h-full items-center justify-center text-sm text-ink-3">
                  No orders in this range.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart accessibilityLayer
                    data={points}
                    margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      stroke="var(--line)"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                      stroke="var(--line-2)"
                      tickMargin={6}
                      interval="preserveStartEnd"
                      minTickGap={16}
                    />
                    {/* Counts left, SAR right — one shared scale would flatten
                        whichever series is smaller into the axis. */}
                    <YAxis
                      yAxisId="orders"
                      tickFormatter={(v: number) => intCompact(v)}
                      tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                      stroke="var(--line-2)"
                      width={48}
                    />
                    <YAxis
                      yAxisId="revenue"
                      orientation="right"
                      tickFormatter={(v: number) => sarCompact(v)}
                      tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                      stroke="var(--line-2)"
                      width={64}
                    />
                    <Tooltip
                      cursor={CHART_CURSOR}
                      content={(p: TooltipProps<number, string>) => {
                        if (!p.active || !p.payload?.length) return null;
                        return (
                          <ChartTooltip>
                            <div className="mb-1 font-medium text-ink">{p.label}</div>
                            {p.payload.map((entry) => {
                              const key = String(entry.dataKey);
                              const isRevenue = key === "revenue" || key === "prevRevenue";
                              const before = key.startsWith("prev");
                              return (
                                <div
                                  key={String(entry.dataKey)}
                                  className="flex items-center gap-2"
                                >
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ background: entry.color }}
                                  />
                                  <span className="text-ink-3">
                                    {isRevenue ? "Revenue" : "Orders"}
                                    {before ? " before" : ""}
                                  </span>
                                  <span className="tabular-nums text-ink ml-auto">
                                    {typeof entry.value !== "number"
                                      ? "—"
                                      : isRevenue
                                        ? sar(entry.value)
                                        : int(entry.value)}
                                  </span>
                                </div>
                              );
                            })}
                          </ChartTooltip>
                        );
                      }}
                    />
                    {shown.has("orders") && (
                      <Bar
                        yAxisId="orders"
                        dataKey="orders"
                        fill={ORDERS_COLOR}
                        radius={[2, 2, 0, 0]}
                        isAnimationActive={false}
                      />
                    )}
                    {shown.has("revenue") && (
                      <Line
                        yAxisId="revenue"
                        type="linear"
                        dataKey="revenue"
                        stroke={REVENUE_COLOR}
                        strokeWidth={CHART_STROKE.primary}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                    )}
                    {/* The previous window, day-aligned: dashed, so "before"
                        reads at a glance without a word on the plot. */}
                    {compare && shown.has("prevOrders") && (
                      <Line
                        yAxisId="orders"
                        type="linear"
                        dataKey="prevOrders"
                        stroke={ORDERS_COLOR}
                        strokeWidth={CHART_STROKE.secondary}
                        strokeDasharray="4 4"
                        dot={false}
                        activeDot={{ r: 3 }}
                        isAnimationActive={false}
                      />
                    )}
                    {compare && shown.has("prevRevenue") && (
                      <Line
                        yAxisId="revenue"
                        type="linear"
                        dataKey="prevRevenue"
                        stroke={REVENUE_COLOR}
                        strokeWidth={CHART_STROKE.secondary}
                        strokeDasharray="4 4"
                        dot={false}
                        activeDot={{ r: 3 }}
                        isAnimationActive={false}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </ChartShell>

      {/* The decision sections — the same filtered orders as the tiles. */}
      <StoreInsightsSections
        lenses={sections.lenses}
        total={sections.total}
        kpis={kpis}
        products={products}
      />

      {/* The explorer: any groupable field, never a personal or ID-like one. */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="shrink-0 text-sm font-medium text-ink">Break down by</h2>
          {dimensions.length > 0 && dimension && (
            <MetricPicker
              ariaLabel="Break down by"
              options={dimensions.map((d) => ({ value: d.key, label: d.label }))}
              value={dimension.key}
              onChange={(key) => update((p) => p.set("by", key))}
            />
          )}
          {dimension && breakdown.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={exportCsv}
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          )}
        </div>

        {!dimension ? (
          <p className={`${panelClass({ padding: "none" })} p-6 text-sm text-ink-3`}>
            This brand has no analyzable order field yet. Add one in Upload
            orders → Order fields.
          </p>
        ) : (
          <>
            <DataTable
              columns={columns}
              {...cols.tableProps}
              rows={rows}
              rowKey={(r) => r.value ?? "__blank__"}
              sort="orders"
              dir="desc"
              showTotals={!empty}
              minWidthClass="min-w-[720px]"
              // The ONE EmptyState (R-059); the page-level state carries the
              // buttons, so this one shows the hint only.
              empty={
                <EmptyState
                  title={
                    empty
                      ? "No orders in this range."
                      : `No ${dimensionNoun(dimension.label)} values in this range.`
                  }
                  kind="range"
                  buttons={false}
                />
              }
            />
            {foldedRow && (
              <p className="text-xs text-ink-3">
                Showing the top {TOP_VALUE_LIMIT} values by orders;{" "}
                {int(foldedRow.foldedCount)} more are folded into “Other”. The CSV
                exports every value{totalValues > breakdown.length ? " the scan returned" : ""}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
