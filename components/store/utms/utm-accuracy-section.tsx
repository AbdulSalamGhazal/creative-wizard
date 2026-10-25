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
import { ChartHeader, ChartShell, ExpandButton } from "@/components/charts/chart-shell";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { SeriesLegend } from "@/components/charts/series-legend";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { PlatformDot } from "@/components/ui/platform-dot";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { cn } from "@/lib/utils";
import type { DateRangeValue } from "@/lib/date-presets";
import {
  dayBucketsInRange,
  monthBucketsInRange,
  weekBucketsInRange,
} from "@/lib/budget";
import { int, intCompact, ratio, signedInt, signedPct } from "@/lib/format";
import { PLATFORM_LABEL, seriesColor, type PlatformKey } from "@/lib/palette";
import { isWithinAttributionLag, reconDeltaTone } from "@/lib/reconciliation";
import {
  accuracyRows,
  bucketizeSeries,
  isPlatformBucket,
  sumAccuracy,
  type PlatformAccuracyRow,
  type UtmBucketDay,
} from "@/lib/store-utms";
import type { UtmClaimedDay } from "@/db/queries/store-utms";

type GroupBy = "day" | "week" | "month";
type Side = "claimed" | "utm";

/** The two sides keep one colour each across the bars and every small panel. */
const SIDE_COLOR: Record<Side, string> = {
  claimed: seriesColor(1),
  utm: seriesColor(0),
};
const SIDE_LABEL: Record<Side, string> = {
  claimed: "Claimed",
  utm: "UTM orders",
};

/** Days in an ISO range, inclusive. */
const rangeDays = (r: DateRangeValue) =>
  Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) + 1;

const ratioX = (v: number | null) => (v === null ? "—" : `${ratio(v)}×`);

/**
 * Platform accuracy: what each platform CLAIMED (conversions in its Ads
 * uploads) beside what its UTMs actually brought (store orders whose source
 * maps to it), for the range and over time. COUNTS ONLY; Δ, Δ% and the ratio
 * come from `lib/reconciliation.ts` through `accuracyRows`, so a platform's
 * gap here is the same number as on Reconciliation.
 */
export function UtmAccuracySection({
  daily,
  claimed,
  range,
  maxHorizon,
}: {
  daily: UtmBucketDay[];
  claimed: UtmClaimedDay[];
  range: DateRangeValue;
  maxHorizon: string | null;
}) {
  // Weekly by default — the point is where the two lines part ways, and a
  // short range would give a week or two of bars, so it opens on days there.
  const [groupBy, setGroupBy] = useState<GroupBy>(() =>
    rangeDays(range) < 14 ? "day" : "week",
  );
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const shown = useMemo(
    () => new Set<Side>((["claimed", "utm"] as Side[]).filter((s) => !hidden.has(s))),
    [hidden],
  );

  const rows = useMemo(() => {
    const utm: Record<string, number> = {};
    const conv: Record<string, number> = {};
    for (const d of daily) {
      if (isPlatformBucket(d.bucket)) utm[d.bucket] = (utm[d.bucket] ?? 0) + d.orders;
    }
    for (const c of claimed) conv[c.platform] = (conv[c.platform] ?? 0) + c.conversions;
    return accuracyRows(utm, conv);
  }, [daily, claimed]);
  const totals = useMemo(() => sumAccuracy(rows), [rows]);
  const stillAttributing = isWithinAttributionLag(range.to, maxHorizon);

  /** Per platform, the two sides bucketed over time. */
  const panels = useMemo(() => {
    const buckets =
      groupBy === "day"
        ? dayBucketsInRange(range.from, range.to)
        : groupBy === "week"
          ? weekBucketsInRange(range.from, range.to)
          : monthBucketsInRange(range.from, range.to);
    return rows.map((r) => ({
      row: r,
      points: bucketizeSeries(
        [
          ...daily
            .filter((d) => d.bucket === r.platform)
            .map((d) => ({ day: d.day, key: "utm", orders: d.orders, revenue: 0 })),
          ...claimed
            .filter((c) => c.platform === r.platform)
            .map((c) => ({ day: c.day, key: "claimed", orders: c.conversions, revenue: 0 })),
        ],
        buckets,
        ["claimed", "utm"],
        "orders",
      ),
    }));
  }, [rows, daily, claimed, groupBy, range.from, range.to]);

  const columns = useMemo(
    (): DataColumn<PlatformAccuracyRow>[] => [
      {
        key: "platform",
        label: "Platform",
        pinned: true,
        sortable: true,
        sortValue: (r) => PLATFORM_LABEL[r.platform],
        defaultSortDir: "asc",
        csv: (r) => PLATFORM_LABEL[r.platform],
        render: (r) => (
          <span className="inline-flex items-center gap-2">
            <PlatformDot platform={r.platform} size="sm" />
            {PLATFORM_LABEL[r.platform]}
          </span>
        ),
      },
      {
        key: "claimed",
        label: "Claimed",
        align: "right",
        sortable: true,
        sortValue: (r) => r.claimed,
        render: (r) => <span className="num tabular-nums">{int(r.claimed)}</span>,
        total: () => <span className="num tabular-nums">{int(totals.claimed)}</span>,
      },
      {
        key: "utm",
        label: "UTM orders",
        align: "right",
        sortable: true,
        sortValue: (r) => r.utm,
        render: (r) => <span className="num tabular-nums">{int(r.utm)}</span>,
        total: () => <span className="num tabular-nums">{int(totals.utm)}</span>,
      },
      {
        key: "delta",
        label: "Δ",
        align: "right",
        sortable: true,
        sortValue: (r) => r.delta,
        render: (r) => (
          <span className="num tabular-nums" title="Claimed − UTM orders">
            {signedInt(r.delta)}
          </span>
        ),
        total: () => <span className="num tabular-nums">{signedInt(totals.delta)}</span>,
      },
      {
        key: "deltaPct",
        label: "Δ%",
        align: "right",
        sortable: true,
        sortValue: (r) => r.deltaPct,
        csv: (r) => r.deltaPct,
        render: (r) => (
          <span
            className={cn("num tabular-nums", reconDeltaTone(r.deltaPct) === "warn" && "text-warn")}
            title="Δ as a share of UTM orders"
          >
            {signedPct(r.deltaPct)}
          </span>
        ),
        total: () => (
          <span
            className={cn("num tabular-nums", reconDeltaTone(totals.deltaPct) === "warn" && "text-warn")}
          >
            {signedPct(totals.deltaPct)}
          </span>
        ),
      },
      {
        key: "ratio",
        label: "Claimed per UTM order",
        align: "right",
        sortable: true,
        sortValue: (r) => r.ratio,
        csv: (r) => r.ratio,
        render: (r) => <span className="num tabular-nums">{ratioX(r.ratio)}</span>,
        total: () => <span className="num tabular-nums">{ratioX(totals.ratio)}</span>,
      },
    ],
    [totals],
  );
  const columnKeys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.STORE_UTM_ACCURACY,
    hideable: columnKeys,
    defaults: columnKeys,
  });

  const legend = (
    <SeriesLegend
      items={(["claimed", "utm"] as Side[]).map((s) => ({
        key: s,
        label: SIDE_LABEL[s],
        color: SIDE_COLOR[s],
      }))}
      shown={shown}
      onToggle={(key) =>
        setHidden((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        })
      }
    />
  );

  const barData = rows.map((r) => ({
    label: PLATFORM_LABEL[r.platform],
    platform: r.platform,
    claimed: r.claimed,
    utm: r.utm,
  }));

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-ink">Platform accuracy</h3>
        <InfoTip label="About platform accuracy">
          Claimed is the conversions a platform reported in your Ads uploads. UTM orders
          are store orders whose UTM source maps to that platform. Δ = claimed − UTM orders:
          positive means the platform claims more than its UTMs show. Pixels count
          view-through and app purchases that carry no UTM, and UTMs are lost on some
          clicks, so a steady ratio matters more than a zero gap. Days within a week of the
          latest ads data are still attributing.
        </InfoTip>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No platform data in this range."
          hint="Upload ads performance and orders with a mapped UTM source for the range to compare them."
          size="sm"
        />
      ) : (
        <>
          <ChartShell ariaLabel="Claimed conversions beside UTM orders, per platform" legend={legend}>
            {({ inFull, toggleExpand }) => (
              <div className={inFull ? "flex h-full flex-col" : undefined}>
                <ChartHeader
                  title="Claimed vs UTM orders"
                  controls={<ExpandButton inFull={inFull} onClick={toggleExpand} />}
                />
                <div
                  className={inFull ? "min-h-0 flex-1" : undefined}
                  style={inFull ? undefined : { height: Math.max(120, rows.length * 48 + 24) }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={barData}
                      layout="vertical"
                      margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                      barCategoryGap={10}
                      barGap={2}
                    >
                      <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" horizontal={false} />
                      <XAxis
                        type="number"
                        tickFormatter={(v: number) => intCompact(v)}
                        tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                        stroke="var(--line-2)"
                        allowDecimals={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        tick={{ fill: "var(--ink-2)", fontSize: 11 }}
                        stroke="var(--line-2)"
                        width={76}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--surface-2)" }}
                        content={(p: TooltipProps<number, string>) => {
                          if (!p.active || !p.payload?.length) return null;
                          const d = p.payload[0]!.payload as (typeof barData)[number];
                          const r = rows.find((x) => x.platform === d.platform)!;
                          return (
                            <ChartTooltip>
                              <div className="mb-1 font-medium text-ink">{d.label}</div>
                              {(["claimed", "utm"] as Side[]).map((s) => (
                                <div key={s} className="flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full" style={{ background: SIDE_COLOR[s] }} />
                                  <span className="text-ink-3">{SIDE_LABEL[s]}</span>
                                  <span className="num tabular-nums text-ink ml-auto">{int(d[s])}</span>
                                </div>
                              ))}
                              <div className="mt-1 flex items-center gap-2 border-t border-line pt-1">
                                <span className="text-ink-3">Δ</span>
                                <span className="num tabular-nums text-ink ml-auto">
                                  {signedInt(r.delta)} ({signedPct(r.deltaPct)})
                                </span>
                              </div>
                            </ChartTooltip>
                          );
                        }}
                      />
                      {shown.has("claimed") && (
                        <Bar dataKey="claimed" name={SIDE_LABEL.claimed} fill={SIDE_COLOR.claimed} radius={[0, 2, 2, 0]} isAnimationActive={false} />
                      )}
                      {shown.has("utm") && (
                        <Bar dataKey="utm" name={SIDE_LABEL.utm} fill={SIDE_COLOR.utm} radius={[0, 2, 2, 0]} isAnimationActive={false} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </ChartShell>

          <DataTable
            columns={columns}
            {...cols.tableProps}
            rows={rows}
            rowKey={(r) => r.platform}
            sort="claimed"
            dir="desc"
            showTotals={rows.length > 1}
            minWidthClass="min-w-[640px]"
          />
          {stillAttributing && (
            <p className="text-xs text-ink-3">
              The range reaches into the last 7 days of ads data, which are still attributing —
              claimed runs low there.
            </p>
          )}

          {/* Over time — one small panel per platform, the two sides as paired bars. */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h4 className="shrink-0 text-sm font-medium text-ink">Over time</h4>
              <div className="ml-auto">
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
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {panels.map(({ row, points }) => (
                <PlatformPanel
                  key={row.platform}
                  platform={row.platform}
                  row={row}
                  points={points}
                  shown={shown}
                />
              ))}
            </div>
            {legend}
          </div>
        </>
      )}
    </section>
  );
}

function PlatformPanel({
  platform,
  row,
  points,
  shown,
}: {
  platform: PlatformKey;
  row: PlatformAccuracyRow;
  points: ReturnType<typeof bucketizeSeries>;
  shown: ReadonlySet<Side>;
}) {
  const warn = reconDeltaTone(row.deltaPct) === "warn";
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <PlatformDot platform={platform} size="sm" />
        <span className="text-xs font-medium text-ink">{PLATFORM_LABEL[platform]}</span>
        <span
          className={cn("ml-auto num tabular-nums text-xs", warn ? "text-warn" : "text-ink-3")}
          title="Claimed per UTM order over the range"
        >
          {ratioX(row.ratio)}
        </span>
      </div>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={1}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--ink-3)", fontSize: 10 }}
              stroke="var(--line-2)"
              tickMargin={4}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) => intCompact(v)}
              tick={{ fill: "var(--ink-3)", fontSize: 10 }}
              stroke="var(--line-2)"
              width={32}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={(p: TooltipProps<number, string>) => {
                if (!p.active || !p.payload?.length) return null;
                const point = p.payload[0]!.payload as (typeof points)[number];
                return (
                  <ChartTooltip>
                    <div className="mb-1 font-medium text-ink">{point.label}</div>
                    {(["claimed", "utm"] as Side[]).map((s) => (
                      <div key={s} className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: SIDE_COLOR[s] }} />
                        <span className="text-ink-3">{SIDE_LABEL[s]}</span>
                        <span className="num tabular-nums text-ink ml-auto">{int(point.values[s])}</span>
                      </div>
                    ))}
                  </ChartTooltip>
                );
              }}
            />
            {shown.has("claimed") && (
              <Bar
                dataKey={(d: (typeof points)[number]) => d.values.claimed ?? 0}
                name={SIDE_LABEL.claimed}
                fill={SIDE_COLOR.claimed}
                isAnimationActive={false}
              />
            )}
            {shown.has("utm") && (
              <Bar
                dataKey={(d: (typeof points)[number]) => d.values.utm ?? 0}
                name={SIDE_LABEL.utm}
                fill={SIDE_COLOR.utm}
                isAnimationActive={false}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
