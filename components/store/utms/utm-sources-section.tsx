"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import { Download } from "lucide-react";
import { ChartHeader, ChartShell, ExpandButton } from "@/components/charts/chart-shell";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { SeriesLegend } from "@/components/charts/series-legend";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { PlatformDot } from "@/components/ui/platform-dot";
import { TABLE_KEYS } from "@/lib/table-columns";
import { cn } from "@/lib/utils";
import type { DateRangeValue } from "@/lib/date-presets";
import {
  dayBucketsInRange,
  monthBucketsInRange,
  weekBucketsInRange,
} from "@/lib/budget";
import { int, intCompact, pct1, sar, signedPct } from "@/lib/format";
import { downloadCsv, matrixToCsv, todayStamp } from "@/lib/csv-export";
import { aov } from "@/lib/store-insights";
import {
  OTHER_VALUE,
  TOP_SOURCE_SERIES,
  UTM_BUCKETS,
  bucketizeSeries,
  foldSources,
  halfSplitTrend,
  isPlatformBucket,
  share,
  sourceKey,
  sourceLabel,
  utmBucketColor,
  utmBucketLabel,
  type FoldedSourceRow,
  type UtmBucket,
  type UtmBucketDay,
  type UtmCoverage,
  type UtmSourceRow,
} from "@/lib/store-utms";
import type { UtmSourceDay } from "@/db/queries/store-utms";

type GroupBy = "day" | "week" | "month";

interface SourceTableRow extends FoldedSourceRow {
  label: string;
  ordersShare: number | null;
  aov: number | null;
  websiteShare: number | null;
  trend: number | null;
}

/** How a bucket reads in the Platform column: a dot and a name, or a dash. */
function BucketCell({ bucket }: { bucket: UtmBucket | null }) {
  if (bucket === null) return <span className="text-ink-3">—</span>;
  if (isPlatformBucket(bucket)) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <PlatformDot platform={bucket} size="sm" />
        {utmBucketLabel(bucket)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-2">
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: utmBucketColor(bucket) }}
        aria-hidden
      />
      {utmBucketLabel(bucket)}
    </span>
  );
}

/**
 * Where orders come from: orders over time stacked by where their source
 * lands (the house platform colours, then the three unknowns), and the table
 * of raw source values beneath — each with its mapped platform, so a value
 * that nobody mapped is visible in the row that carries it.
 */
export function UtmSourcesSection({
  daily,
  breakdown,
  totalValues,
  sourceDaily,
  range,
  coverage,
  sourceFieldLabel,
}: {
  daily: UtmBucketDay[];
  breakdown: UtmSourceRow[];
  totalValues: number;
  sourceDaily: UtmSourceDay[];
  range: DateRangeValue;
  coverage: UtmCoverage;
  sourceFieldLabel: string;
}) {
  // Bucketing is a VIEW control (client state), like Insights' trend.
  const [groupBy, setGroupBy] = useState<GroupBy>("day");

  // ── Trend ──────────────────────────────────────────────────────────────────
  const present = useMemo(() => {
    const totals = new Map<UtmBucket, number>();
    for (const d of daily) totals.set(d.bucket, (totals.get(d.bucket) ?? 0) + d.orders);
    return UTM_BUCKETS.filter((b) => (totals.get(b) ?? 0) > 0);
  }, [daily]);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const shown = useMemo(
    () => new Set(present.filter((b) => !hidden.has(b))),
    [present, hidden],
  );

  const points = useMemo(() => {
    const buckets =
      groupBy === "day"
        ? dayBucketsInRange(range.from, range.to)
        : groupBy === "week"
          ? weekBucketsInRange(range.from, range.to)
          : monthBucketsInRange(range.from, range.to);
    return bucketizeSeries(
      daily.map((d) => ({ day: d.day, key: d.bucket, orders: d.orders, revenue: d.revenue })),
      buckets,
      present,
      "orders",
    );
  }, [daily, groupBy, present, range.from, range.to]);

  // ── Table ──────────────────────────────────────────────────────────────────
  const website = useMemo(() => breakdown.reduce((a, r) => a + r.website, 0), [breakdown]);
  const application = useMemo(
    () => breakdown.reduce((a, r) => a + r.application, 0),
    [breakdown],
  );
  const folded = useMemo(
    () =>
      foldSources(breakdown, TOP_SOURCE_SERIES, {
        orders: coverage.orders,
        revenue: coverage.revenue,
        website,
        application,
        values: totalValues,
      }),
    [breakdown, coverage.orders, coverage.revenue, website, application, totalValues],
  );

  /** Per-source half-vs-half trend, from the per-day series of the top sources. */
  const trendByKey = useMemo(() => {
    const byKey = new Map<string, Array<{ day: string; orders: number }>>();
    for (const d of sourceDaily) {
      const k = sourceKey(d.value);
      const list = byKey.get(k);
      if (list) list.push({ day: d.day, orders: d.orders });
      else byKey.set(k, [{ day: d.day, orders: d.orders }]);
    }
    const out = new Map<string, number | null>();
    for (const [k, list] of byKey) out.set(k, halfSplitTrend(list, range).pct);
    return out;
  }, [sourceDaily, range]);
  const totalTrend = useMemo(
    () =>
      halfSplitTrend(
        daily.map((d) => ({ day: d.day, orders: d.orders })),
        range,
      ).pct,
    [daily, range],
  );

  const rows = useMemo(
    (): SourceTableRow[] =>
      folded.map((r) => ({
        ...r,
        label:
          r.value === OTHER_VALUE
            ? `Other (${r.foldedCount} value${r.foldedCount === 1 ? "" : "s"})`
            : sourceLabel(r.value, sourceFieldLabel),
        ordersShare: share(r.orders, coverage.orders),
        aov: aov(r.revenue, r.orders),
        websiteShare: share(r.website, r.orders),
        trend: r.value === OTHER_VALUE ? null : (trendByKey.get(sourceKey(r.value)) ?? null),
      })),
    [folded, sourceFieldLabel, coverage.orders, trendByKey],
  );
  const foldedRow = folded.find((r) => r.value === OTHER_VALUE);

  const columns = useMemo((): DataColumn<SourceTableRow>[] => {
    // "Other" is a summary, not a value: it sinks in every sort (null sort value).
    const sortOf = <V,>(r: SourceTableRow, v: V) => (r.value === OTHER_VALUE ? null : v);
    return [
      {
        key: "source",
        label: sourceFieldLabel,
        pinned: true,
        sortable: true,
        sortValue: (r) => sortOf(r, r.label),
        defaultSortDir: "asc",
        csv: (r) => r.label,
        render: (r) => (
          <span
            className={cn(
              "block max-w-[11rem] truncate sm:max-w-none",
              r.value === null || r.value === OTHER_VALUE ? "text-ink-2" : "text-ink",
            )}
            title={r.label}
          >
            {r.label}
          </span>
        ),
      },
      {
        key: "platform",
        label: "Platform",
        sortable: true,
        sortValue: (r) => sortOf(r, r.bucket === null ? null : utmBucketLabel(r.bucket)),
        defaultSortDir: "asc",
        csv: (r) => (r.bucket === null ? "" : utmBucketLabel(r.bucket)),
        render: (r) => <BucketCell bucket={r.bucket} />,
      },
      {
        key: "orders",
        label: "Orders",
        align: "right",
        sortable: true,
        sortValue: (r) => sortOf(r, r.orders),
        render: (r) => <span className="num tabular-nums">{int(r.orders)}</span>,
        total: () => <span className="num tabular-nums">{int(coverage.orders)}</span>,
      },
      {
        key: "ordersShare",
        label: "% of orders",
        align: "right",
        sortable: true,
        sortValue: (r) => sortOf(r, r.ordersShare),
        csv: (r) => r.ordersShare,
        render: (r) => (
          <div className="flex items-center justify-end gap-2">
            <span className="relative h-1.5 w-16 shrink-0 rounded-full bg-surface-2" aria-hidden>
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-brand"
                style={{ width: `${Math.min(100, (r.ordersShare ?? 0) * 100)}%` }}
              />
            </span>
            <span className="num tabular-nums w-12">{pct1(r.ordersShare)}</span>
          </div>
        ),
        total: () => <span className="num tabular-nums">{pct1(1)}</span>,
      },
      {
        key: "revenue",
        label: "Revenue (SAR)",
        align: "right",
        sortable: true,
        sortValue: (r) => sortOf(r, r.revenue),
        render: (r) => <span className="num tabular-nums">{sar(r.revenue)}</span>,
        total: () => <span className="num tabular-nums">{sar(coverage.revenue)}</span>,
      },
      {
        key: "aov",
        label: "AOV",
        align: "right",
        sortable: true,
        sortValue: (r) => sortOf(r, r.aov),
        render: (r) => <span className="num tabular-nums">{r.aov === null ? "—" : sar(r.aov)}</span>,
        total: () => {
          const a = aov(coverage.revenue, coverage.orders);
          return <span className="num tabular-nums">{a === null ? "—" : sar(a)}</span>;
        },
      },
      {
        key: "websiteShare",
        label: "Website %",
        align: "right",
        sortable: true,
        sortValue: (r) => sortOf(r, r.websiteShare),
        csv: (r) => r.websiteShare,
        render: (r) => <span className="num tabular-nums">{pct1(r.websiteShare)}</span>,
        total: () => (
          <span className="num tabular-nums">{pct1(share(website, coverage.orders))}</span>
        ),
      },
      {
        key: "trend",
        label: "Trend",
        align: "right",
        sortable: true,
        sortValue: (r) => sortOf(r, r.trend),
        csv: (r) => r.trend,
        render: (r) => (
          <span
            className="num tabular-nums"
            title="Orders per day, second half of the range vs the first"
          >
            {signedPct(r.trend)}
          </span>
        ),
        total: () => <span className="num tabular-nums">{signedPct(totalTrend)}</span>,
      },
    ];
  }, [sourceFieldLabel, coverage.orders, coverage.revenue, website, totalTrend]);

  const columnKeys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.STORE_UTM_SOURCES,
    hideable: columnKeys,
    defaults: columnKeys,
    // The channel split is context — on by request, like Reconciliation's
    // money columns.
    defaultHidden: ["websiteShare"],
  });

  /** CSV exports the FULL breakdown — every value, not the folded top-N. */
  const exportCsv = () => {
    const sorted = [...breakdown].sort((a, b) => b.orders - a.orders);
    const head = [
      sourceFieldLabel,
      "Platform",
      "Orders",
      "% of orders",
      "Revenue (SAR)",
      "AOV",
      "Website %",
      "Trend",
    ];
    const lines = sorted.map((r): Array<string | number> => {
      const os = share(r.orders, coverage.orders);
      const a = aov(r.revenue, r.orders);
      const ws = share(r.website, r.orders);
      const t = trendByKey.get(sourceKey(r.value));
      return [
        sourceLabel(r.value, sourceFieldLabel),
        utmBucketLabel(r.bucket),
        r.orders,
        os ?? "",
        r.revenue,
        a ?? "",
        ws ?? "",
        t === null || t === undefined ? "" : t,
      ];
    });
    downloadCsv(`store-utm-sources-${todayStamp()}.csv`, matrixToCsv(head, lines));
  };

  return (
    <section className="space-y-3">
      <ChartShell
        ariaLabel="Orders over the range, stacked by source"
        legend={
          <SeriesLegend
            items={present.map((b) => ({ key: b, label: utmBucketLabel(b), color: utmBucketColor(b) }))}
            shown={shown}
            onToggle={(key) =>
              setHidden((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            onShowAll={() => setHidden(new Set())}
          />
        }
      >
        {({ inFull, toggleExpand }) => (
          <div className={inFull ? "flex h-full flex-col" : undefined}>
            <ChartHeader
              title="Orders by source"
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
            <div className={inFull ? "min-h-0 flex-1" : "h-64"}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={points} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
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
                    tickFormatter={(v: number) => intCompact(v)}
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                    width={44}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--surface-2)" }}
                    content={(p: TooltipProps<number, string>) => {
                      if (!p.active || !p.payload?.length) return null;
                      const point = p.payload[0]!.payload as (typeof points)[number];
                      const visible = present.filter((b) => shown.has(b) && point.values[b]! > 0);
                      const total = visible.reduce((a, b) => a + point.values[b]!, 0);
                      return (
                        <ChartTooltip>
                          <div className="mb-1 font-medium text-ink">{point.label}</div>
                          {visible.map((b) => (
                            <div key={b} className="flex items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: utmBucketColor(b) }}
                              />
                              <span className="text-ink-3">{utmBucketLabel(b)}</span>
                              <span className="num tabular-nums text-ink ml-auto">
                                {int(point.values[b])}
                              </span>
                            </div>
                          ))}
                          {visible.length > 1 && (
                            <div className="mt-1 flex items-center gap-2 border-t border-line pt-1">
                              <span className="text-ink-3">Total</span>
                              <span className="num tabular-nums text-ink ml-auto">{int(total)}</span>
                            </div>
                          )}
                        </ChartTooltip>
                      );
                    }}
                  />
                  {present.map(
                    (b) =>
                      shown.has(b) && (
                        <Bar
                          key={b}
                          dataKey={(d: (typeof points)[number]) => d.values[b] ?? 0}
                          name={utmBucketLabel(b)}
                          stackId="orders"
                          fill={utmBucketColor(b)}
                          isAnimationActive={false}
                        />
                      ),
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </ChartShell>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="shrink-0 text-sm font-medium text-ink">Sources</h3>
          <Button variant="outline" size="sm" className="ml-auto" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
        </div>
        <DataTable
          columns={columns}
          {...cols.tableProps}
          rows={rows}
          rowKey={(r) => sourceKey(r.value)}
          sort="orders"
          dir="desc"
          showTotals
          minWidthClass="min-w-[760px]"
          empty={<p className="text-sm text-ink-3">No orders in this range.</p>}
        />
        {foldedRow && (
          <p className="text-xs text-ink-3">
            Showing the top {TOP_SOURCE_SERIES} values by orders; {int(foldedRow.foldedCount)}{" "}
            more are folded into “Other”. The CSV exports every value.
          </p>
        )}
      </div>
    </section>
  );
}
