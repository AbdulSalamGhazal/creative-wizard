"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import { Plus, X } from "lucide-react";
import { ChartHeader, ChartShell, ExpandButton } from "@/components/charts/chart-shell";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { MetricPicker } from "@/components/charts/metric-picker";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import type { DateRangeValue } from "@/lib/date-presets";
import {
  dayBucketsInRange,
  monthBucketsInRange,
  weekBucketsInRange,
} from "@/lib/budget";
import { int, intCompact, pct1, sar, sarCompact, signedPct } from "@/lib/format";
import { seriesColor } from "@/lib/palette";
import { shallowParams } from "@/lib/shallow-url";
import { aov } from "@/lib/store-insights";
import {
  COMPARE_MAX,
  bucketizeSeries,
  defaultCompare,
  encodeCompareParam,
  halfSplitTrend,
  parseCompareParam,
  share,
  sourceFromKey,
  sourceKey,
  sourceLabel,
  type UtmSourceRow,
} from "@/lib/store-utms";
import type { UtmSourceDay } from "@/db/queries/store-utms";

type GroupBy = "day" | "week" | "month";
type Metric = "orders" | "revenue";

interface CompareRow {
  key: string;
  label: string;
  color: string;
  orders: number;
  revenue: number;
  ordersShare: number | null;
  aov: number | null;
  websiteShare: number | null;
  trend: number | null;
}

/**
 * Compare sources side by side: pick up to six, read them overlaid on one
 * chart and in one table. The selection is a SHALLOW `?compare=` param
 * (D12): the series for the top sources are already on the page, so adding
 * one re-renders from rows the client holds and costs no server render — but
 * the URL still carries the choice, so it can be shared. No selection in the
 * URL means the top three by orders; an explicit empty one means none.
 */
export function UtmCompareSection({
  rows,
  sourceDaily,
  range,
  totalOrders,
  sourceFieldLabel,
}: {
  /** The top sources (the ones with per-day series), largest first. */
  rows: UtmSourceRow[];
  sourceDaily: UtmSourceDay[];
  range: DateRangeValue;
  totalOrders: number;
  sourceFieldLabel: string;
}) {
  const searchParams = useSearchParams();
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const [metric, setMetric] = useState<Metric>("orders");
  const [open, setOpen] = useState(false);

  const byKey = useMemo(() => new Map(rows.map((r) => [sourceKey(r.value), r])), [rows]);
  const available = useMemo(() => new Set(byKey.keys()), [byKey]);

  const raw = searchParams.get("compare");
  const selected = useMemo(
    () => (raw === null ? defaultCompare(rows) : parseCompareParam(raw, available)),
    [raw, rows, available],
  );
  const write = (keys: readonly string[]) =>
    shallowParams((p) => p.set("compare", encodeCompareParam(keys)), "replace");
  const add = (key: string) => {
    if (selected.length >= COMPARE_MAX || selected.includes(key)) return;
    write([...selected, key]);
    setOpen(false);
  };
  const remove = (key: string) => write(selected.filter((k) => k !== key));

  const colorOf = (key: string) => seriesColor(Math.max(0, selected.indexOf(key)));
  const labelOf = (key: string) => sourceLabel(sourceFromKey(key), sourceFieldLabel);

  // ── Chart ──────────────────────────────────────────────────────────────────
  const points = useMemo(() => {
    const buckets =
      groupBy === "day"
        ? dayBucketsInRange(range.from, range.to)
        : groupBy === "week"
          ? weekBucketsInRange(range.from, range.to)
          : monthBucketsInRange(range.from, range.to);
    return bucketizeSeries(
      sourceDaily.map((d) => ({
        day: d.day,
        key: sourceKey(d.value),
        orders: d.orders,
        revenue: d.revenue,
      })),
      buckets,
      selected,
      metric,
    );
  }, [sourceDaily, groupBy, selected, metric, range.from, range.to]);

  const fmt = (v: number | null | undefined) =>
    typeof v !== "number" ? "—" : metric === "orders" ? int(v) : sar(v);

  // ── Table ──────────────────────────────────────────────────────────────────
  const dailyByKey = useMemo(() => {
    const out = new Map<string, Array<{ day: string; orders: number }>>();
    for (const d of sourceDaily) {
      const k = sourceKey(d.value);
      const list = out.get(k);
      if (list) list.push({ day: d.day, orders: d.orders });
      else out.set(k, [{ day: d.day, orders: d.orders }]);
    }
    return out;
  }, [sourceDaily]);

  const tableRows = useMemo(
    (): CompareRow[] =>
      selected.flatMap((key) => {
        const r = byKey.get(key);
        if (!r) return [];
        return [
          {
            key,
            label: labelOf(key),
            color: colorOf(key),
            orders: r.orders,
            revenue: r.revenue,
            ordersShare: share(r.orders, totalOrders),
            aov: aov(r.revenue, r.orders),
            websiteShare: share(r.website, r.orders),
            trend: halfSplitTrend(dailyByKey.get(key) ?? [], range).pct,
          },
        ];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, byKey, totalOrders, dailyByKey, range, sourceFieldLabel],
  );

  const totals = useMemo(() => {
    const orders = tableRows.reduce((a, r) => a + r.orders, 0);
    const revenue = tableRows.reduce((a, r) => a + r.revenue, 0);
    const website = selected.reduce((a, k) => a + (byKey.get(k)?.website ?? 0), 0);
    // The selection's combined per-day series, for one honest trend.
    const perDay = new Map<string, number>();
    for (const k of selected) {
      for (const d of dailyByKey.get(k) ?? []) perDay.set(d.day, (perDay.get(d.day) ?? 0) + d.orders);
    }
    const trend = halfSplitTrend(
      [...perDay].map(([day, o]) => ({ day, orders: o })),
      range,
    ).pct;
    return { orders, revenue, website, trend };
  }, [tableRows, selected, byKey, dailyByKey, range]);

  const columns = useMemo(
    (): DataColumn<CompareRow>[] => [
      {
        key: "source",
        label: sourceFieldLabel,
        pinned: true,
        sortable: true,
        sortValue: (r) => r.label,
        defaultSortDir: "asc",
        csv: (r) => r.label,
        render: (r) => (
          <span className="inline-flex max-w-[11rem] items-center gap-2 sm:max-w-none">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
            <span className="truncate" title={r.label}>
              {r.label}
            </span>
          </span>
        ),
      },
      {
        key: "orders",
        label: "Orders",
        align: "right",
        sortable: true,
        sortValue: (r) => r.orders,
        render: (r) => <span className="num tabular-nums">{int(r.orders)}</span>,
        total: () => <span className="num tabular-nums">{int(totals.orders)}</span>,
      },
      {
        key: "ordersShare",
        label: "% of orders",
        align: "right",
        sortable: true,
        sortValue: (r) => r.ordersShare,
        csv: (r) => r.ordersShare,
        render: (r) => <span className="num tabular-nums">{pct1(r.ordersShare)}</span>,
        total: () => (
          <span className="num tabular-nums">{pct1(share(totals.orders, totalOrders))}</span>
        ),
      },
      {
        key: "revenue",
        label: "Revenue (SAR)",
        align: "right",
        sortable: true,
        sortValue: (r) => r.revenue,
        render: (r) => <span className="num tabular-nums">{sar(r.revenue)}</span>,
        total: () => <span className="num tabular-nums">{sar(totals.revenue)}</span>,
      },
      {
        key: "aov",
        label: "AOV",
        align: "right",
        sortable: true,
        sortValue: (r) => r.aov,
        render: (r) => <span className="num tabular-nums">{r.aov === null ? "—" : sar(r.aov)}</span>,
        total: () => {
          const a = aov(totals.revenue, totals.orders);
          return <span className="num tabular-nums">{a === null ? "—" : sar(a)}</span>;
        },
      },
      {
        key: "websiteShare",
        label: "Website %",
        align: "right",
        sortable: true,
        sortValue: (r) => r.websiteShare,
        csv: (r) => r.websiteShare,
        render: (r) => <span className="num tabular-nums">{pct1(r.websiteShare)}</span>,
        total: () => (
          <span className="num tabular-nums">{pct1(share(totals.website, totals.orders))}</span>
        ),
      },
      {
        key: "trend",
        label: "Trend",
        align: "right",
        sortable: true,
        sortValue: (r) => r.trend,
        csv: (r) => r.trend,
        render: (r) => (
          <span className="num tabular-nums" title="Orders per day, second half of the range vs the first">
            {signedPct(r.trend)}
          </span>
        ),
        total: () => <span className="num tabular-nums">{signedPct(totals.trend)}</span>,
      },
    ],
    [sourceFieldLabel, totals, totalOrders],
  );
  const columnKeys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.STORE_UTM_COMPARE,
    hideable: columnKeys,
    defaults: columnKeys,
  });

  const candidates = rows.filter((r) => !selected.includes(sourceKey(r.value)));
  const full = selected.length >= COMPARE_MAX;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="shrink-0 text-sm font-medium text-ink">Compare sources</h3>
        {selected.map((key) => (
          <span
            key={key}
            className="inline-flex h-7 max-w-[14rem] items-center gap-1.5 rounded-md border border-line bg-surface pl-2 pr-1 text-xs text-ink"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(key) }} aria-hidden />
            <span className="truncate" title={labelOf(key)}>
              {labelOf(key)}
            </span>
            <button
              type="button"
              onClick={() => remove(key)}
              aria-label={`Remove ${labelOf(key)}`}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={full || candidates.length === 0}
              title={
                full
                  ? `Up to ${COMPARE_MAX} sources at a time`
                  : candidates.length === 0
                    ? "Every source in range is already selected"
                    : undefined
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add source
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <Command>
              <CommandInput placeholder="Search sources…" />
              <CommandList>
                <CommandEmpty>No source matches.</CommandEmpty>
                <CommandGroup>
                  {candidates.map((r) => {
                    const key = sourceKey(r.value);
                    const label = labelOf(key);
                    return (
                      <CommandItem key={key} value={label} onSelect={() => add(key)}>
                        <span className="truncate" title={label}>
                          {label}
                        </span>
                        <span className="ml-auto num tabular-nums text-xs text-ink-3">
                          {int(r.orders)}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <ChartShell ariaLabel="Selected sources over the range">
        {({ inFull, toggleExpand }) => (
          <div className={inFull ? "flex h-full flex-col" : undefined}>
            <ChartHeader
              title="Over time"
              picker={
                <MetricPicker<Metric>
                  ariaLabel="Metric"
                  value={metric}
                  onChange={setMetric}
                  options={[
                    { value: "orders", label: "Orders" },
                    { value: "revenue", label: "Revenue (SAR)" },
                  ]}
                />
              }
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
              {selected.length === 0 ? (
                <EmptyState
                  title="No sources selected."
                  hint="Add a source above to see it here."
                  size="sm"
                  buttons={false}
                  className="flex h-full flex-col items-center justify-center border-0 bg-transparent"
                />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={points} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
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
                      tickFormatter={(v: number) => (metric === "orders" ? intCompact(v) : sarCompact(v))}
                      tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                      stroke="var(--line-2)"
                      width={metric === "orders" ? 44 : 64}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={(p: TooltipProps<number, string>) => {
                        if (!p.active || !p.payload?.length) return null;
                        const point = p.payload[0]!.payload as (typeof points)[number];
                        return (
                          <ChartTooltip>
                            <div className="mb-1 font-medium text-ink">{point.label}</div>
                            {selected.map((k) => (
                              <div key={k} className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{ background: colorOf(k) }} />
                                <span className="max-w-[10rem] truncate text-ink-3">{labelOf(k)}</span>
                                <span className="num tabular-nums text-ink ml-auto">
                                  {fmt(point.values[k])}
                                </span>
                              </div>
                            ))}
                          </ChartTooltip>
                        );
                      }}
                    />
                    {selected.map((k) => (
                      <Line
                        key={k}
                        type="linear"
                        dataKey={(d: (typeof points)[number]) => d.values[k] ?? 0}
                        name={labelOf(k)}
                        stroke={colorOf(k)}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </ChartShell>

      {selected.length > 0 && (
        <DataTable
          columns={columns}
          {...cols.tableProps}
          rows={tableRows}
          rowKey={(r) => r.key}
          sort="orders"
          dir="desc"
          showTotals={tableRows.length > 1}
          minWidthClass="min-w-[720px]"
        />
      )}
    </section>
  );
}
