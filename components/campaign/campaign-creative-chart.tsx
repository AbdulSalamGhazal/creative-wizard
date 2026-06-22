"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { intCompact, pct, ratio, usd, usdCompact } from "@/lib/format";
import { seriesColor } from "@/lib/palette";
import { MetricPicker } from "@/components/charts/metric-picker";
import { SeriesLegend } from "@/components/charts/series-legend";
import { ChartShell, ExpandButton, SmoothToggle } from "@/components/charts/chart-shell";
import { smoothColumns } from "@/lib/chart-smooth";
import type { CampaignCreativeDailyPoint } from "@/db/queries/campaign";

type MetricKey =
  | "spend"
  | "conversionValue"
  | "conversions"
  | "impressions"
  | "clicks"
  | "ctr"
  | "cvr"
  | "roas"
  | "cpa"
  | "cpm"
  | "voc";
type Kind = "usd" | "int" | "pct" | "ratio";

const METRICS: Array<{ key: MetricKey; label: string; kind: Kind }> = [
  { key: "spend", label: "Spend", kind: "usd" },
  { key: "conversionValue", label: "Revenue", kind: "usd" },
  { key: "conversions", label: "Conversions", kind: "int" },
  { key: "impressions", label: "Impressions", kind: "int" },
  { key: "clicks", label: "Clicks", kind: "int" },
  { key: "ctr", label: "CTR", kind: "pct" },
  { key: "cvr", label: "CvR", kind: "pct" },
  { key: "roas", label: "ROAS", kind: "ratio" },
  { key: "cpa", label: "CPA", kind: "usd" },
  { key: "cpm", label: "CPM", kind: "usd" },
  { key: "voc", label: "VOC", kind: "pct" },
];

const DEFAULT_SHOWN = 6;

const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const axisFmt = (kind: Kind) => (v: number) => {
  if (kind === "usd") return usdCompact(v);
  if (kind === "int") return intCompact(v);
  if (kind === "pct") return `${(v * 100).toFixed(0)}%`;
  return `${v.toFixed(1)}×`;
};
const cellFmt = (kind: Kind, v: number | null) => {
  if (kind === "usd") return usd(v);
  if (kind === "int") return v === null ? "—" : intCompact(v);
  if (kind === "pct") return pct(v);
  return ratio(v);
};

interface Row {
  date: string;
  [creativeId: string]: number | null | string;
}

/**
 * One line per creative over time, for whatever metric is selected. Click a
 * legend chip to hide a creative; Smooth applies a 7-day moving average; Expand
 * fills the screen keeping every control.
 */
export function CampaignCreativeChart({
  points,
  creatives,
}: {
  points: CampaignCreativeDailyPoint[];
  creatives: Array<{ creativeId: string; name: string }>;
}) {
  const [metric, setMetric] = useState<MetricKey>("spend");
  const [smooth, setSmooth] = useState(false);
  const [shown, setShown] = useState<Set<string>>(
    () => new Set(creatives.slice(0, DEFAULT_SHOWN).map((c) => c.creativeId)),
  );

  const meta = METRICS.find((m) => m.key === metric)!;

  const data = useMemo<Row[]>(() => {
    const byDate = new Map<string, Row>();
    for (const p of points) {
      let row = byDate.get(p.date);
      if (!row) {
        row = { date: p.date };
        byDate.set(p.date, row);
      }
      row[p.creativeId] = p[metric];
    }
    const rows = [...byDate.values()].sort((a, b) =>
      (a.date as string) < (b.date as string) ? -1 : 1,
    );
    return smooth
      ? smoothColumns(rows, creatives.map((c) => c.creativeId))
      : rows;
  }, [points, metric, smooth, creatives]);

  const toggle = (id: string) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Color by rank in the (spend-sorted) creative list so no two collide.
  const colorOf = useMemo(
    () => new Map(creatives.map((c, i) => [c.creativeId, seriesColor(i)])),
    [creatives],
  );
  const color = (id: string) => colorOf.get(id) ?? "#888";

  const visible = creatives
    .filter((c) => shown.has(c.creativeId))
    .map((c) => ({ ...c, color: color(c.creativeId) }));

  const header = (inFull: boolean, toggleExpand: () => void) => (
    <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm text-ink-2">By creative over time</h3>
        <MetricPicker
          options={METRICS.map((m) => ({ value: m.key, label: m.label }))}
          value={metric}
          onChange={setMetric}
        />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <SmoothToggle on={smooth} onToggle={() => setSmooth((v) => !v)} />
        <ExpandButton inFull={inFull} onClick={toggleExpand} />
      </div>
    </div>
  );

  const legend = (
    <SeriesLegend
      className="mb-2"
      items={creatives.map((c) => ({
        key: c.creativeId,
        label: c.name,
        color: color(c.creativeId),
      }))}
      shown={shown}
      onToggle={toggle}
    />
  );

  const chart = (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => monthDay.format(new Date(d))}
          tick={{ fill: "var(--ink-3)", fontSize: 11 }}
          stroke="var(--line-2)"
          tickMargin={6}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={axisFmt(meta.kind)}
          tick={{ fill: "var(--ink-3)", fontSize: 11 }}
          stroke="var(--line-2)"
          width={48}
        />
        <Tooltip content={<ChartTip visible={visible} kind={meta.kind} metricLabel={meta.label} />} />
        {visible.map((c) => (
          <Line
            key={c.creativeId}
            type="monotone"
            dataKey={c.creativeId}
            name={c.name}
            stroke={c.color}
            strokeWidth={1.8}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );

  const empty = (
    <div className="h-full flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
      No data in this window.
    </div>
  );

  return (
    <ChartShell ariaLabel="By creative over time — expanded">
      {({ inFull, toggleExpand }) => (
        <>
          {header(inFull, toggleExpand)}
          {legend}
          <div className={inFull ? "flex-1 min-h-0" : "h-80"}>
            {data.length === 0 ? empty : chart}
          </div>
        </>
      )}
    </ChartShell>
  );
}

function ChartTip({
  active,
  label,
  payload,
  visible,
  kind,
  metricLabel,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ dataKey: string; value: number | null }>;
  visible: Array<{ creativeId: string; name: string; color: string }>;
  kind: Kind;
  metricLabel: string;
}) {
  if (!active || !payload || payload.length === 0 || !label) return null;
  const byKey = new Map(payload.map((p) => [p.dataKey, p.value]));
  // Show the creatives with a value this day, biggest first.
  const rows = visible
    .map((c) => ({ c, v: byKey.get(c.creativeId) ?? null }))
    .filter((r) => r.v !== null && r.v !== undefined)
    .sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
  return (
    <div className="rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg max-w-[18rem]">
      <div className="text-ink-2 mb-1.5">
        {monthDay.format(new Date(label))} · {metricLabel}
      </div>
      <div className="space-y-1">
        {rows.length === 0 ? (
          <div className="text-ink-3">No data</div>
        ) : (
          rows.map(({ c, v }) => (
            <div key={c.creativeId} className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-sm shrink-0"
                style={{ background: c.color }}
              />
              <span className="text-ink-2 truncate max-w-[10rem]">{c.name}</span>
              <span className="ml-auto text-ink num tabular-nums">{cellFmt(kind, v)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
