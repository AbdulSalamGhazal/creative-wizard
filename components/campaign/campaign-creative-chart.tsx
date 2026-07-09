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
import { intCompact, pct, ratio, usd, usdCompact, monthDay } from "@/lib/format";
import { seriesColor } from "@/lib/palette";
import { MetricPicker } from "@/components/charts/metric-picker";
import { SeriesLegend } from "@/components/charts/series-legend";
import { ChartHeader, ChartShell, ExpandButton, SmoothToggle, GroupToggle } from "@/components/charts/chart-shell";
import { useChartFit, ChartFitToggle } from "@/components/charts/chart-fit";
import { smoothColumns } from "@/lib/chart-smooth";
import type { CampaignCreativeDailyPoint } from "@/db/queries/campaign";
import { ChartTooltip } from "@/components/charts/chart-tooltip";

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

/** Metrics that simply sum when grouped. Everything else is a ratio. */
const ADDITIVE = new Set<MetricKey>([
  "spend",
  "conversionValue",
  "conversions",
  "impressions",
  "clicks",
]);
/** A ratio's denominator → lets Group recombine it correctly (never average). */
const WEIGHT: Partial<Record<MetricKey, (p: CampaignCreativeDailyPoint) => number>> = {
  ctr: (p) => p.impressions,
  cpm: (p) => p.impressions,
  cpa: (p) => p.conversions,
  voc: (p) => p.clicks,
  cvr: (p) => p.landingPageViews,
  roas: (p) => p.spend,
};

/** Combine the points of one date into a single value for the chosen metric. */
function aggMetric(metric: MetricKey, pts: CampaignCreativeDailyPoint[]): number | null {
  if (ADDITIVE.has(metric)) {
    let sum = 0;
    let any = false;
    for (const p of pts) {
      const v = p[metric] as number | null;
      if (typeof v === "number") {
        sum += v;
        any = true;
      }
    }
    return any ? sum : null;
  }
  const w = WEIGHT[metric];
  if (!w) return null;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    const v = p[metric] as number | null;
    const ww = w(p);
    if (typeof v === "number" && typeof ww === "number") {
      num += v * ww;
      den += ww;
    }
  }
  return den > 0 ? num / den : null;
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
  const [group, setGroup] = useState(false);
  const [shown, setShown] = useState<Set<string>>(
    () => new Set(creatives.slice(0, DEFAULT_SHOWN).map((c) => c.creativeId)),
  );

  const meta = METRICS.find((m) => m.key === metric)!;

  const data = useMemo<Row[]>(() => {
    const byDate = new Map<string, Row>();
    if (group) {
      // One combined line: aggregate the shown creatives' points per date.
      const ptsByDate = new Map<string, CampaignCreativeDailyPoint[]>();
      for (const p of points) {
        if (!shown.has(p.creativeId)) continue;
        const arr = ptsByDate.get(p.date);
        if (arr) arr.push(p);
        else ptsByDate.set(p.date, [p]);
      }
      for (const [date, pts] of ptsByDate) byDate.set(date, { date, all: aggMetric(metric, pts) });
    } else {
      for (const p of points) {
        let row = byDate.get(p.date);
        if (!row) {
          row = { date: p.date };
          byDate.set(p.date, row);
        }
        row[p.creativeId] = p[metric];
      }
    }
    const rows = [...byDate.values()].sort((a, b) =>
      (a.date as string) < (b.date as string) ? -1 : 1,
    );
    const cols = group ? ["all"] : creatives.map((c) => c.creativeId);
    return smooth ? smoothColumns(rows, cols) : rows;
  }, [points, metric, smooth, creatives, group, shown]);

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

  // The lines drawn + tooltip rows: one combined line when grouped, else the
  // shown creatives. (Grouped, the legend still picks which creatives sum in.)
  const lineSpecs = group
    ? [{ creativeId: "all", name: "All creatives", color: "var(--brand)" }]
    : visible;

  // Robust axis fit — cap a lone spike, with a toggle to show the full range.
  const yValues = useMemo(() => {
    const out: number[] = [];
    for (const row of data)
      for (const l of lineSpecs) {
        const v = row[l.creativeId];
        if (typeof v === "number") out.push(v);
      }
    return out;
  }, [data, lineSpecs]);
  const fit = useChartFit(yValues);

  const header = (inFull: boolean, toggleExpand: () => void) => (
    <ChartHeader
      title="By creative over time"
      picker={
        <MetricPicker
          options={METRICS.map((m) => ({ value: m.key, label: m.label }))}
          value={metric}
          onChange={setMetric}
        />
      }
      controls={
        <>
          <GroupToggle on={group} onToggle={() => setGroup((v) => !v)} />
          <SmoothToggle on={smooth} onToggle={() => setSmooth((v) => !v)} />
          <ExpandButton inFull={inFull} onClick={toggleExpand} />
        </>
      }
    />
  );

  const legend = (
    <SeriesLegend
      items={creatives.map((c) => ({
        key: c.creativeId,
        label: c.name,
        color: color(c.creativeId),
      }))}
      shown={shown}
      onToggle={toggle}
      onShowAll={() => setShown(new Set(creatives.map((c) => c.creativeId)))}
    />
  );

  const chart = (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => monthDay(d)}
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
          domain={fit.clip ? [0, fit.cap] : undefined}
          allowDataOverflow={fit.clip}
        />
        <Tooltip content={<ChartTip visible={lineSpecs} kind={meta.kind} metricLabel={meta.label} />} />
        {lineSpecs.map((c) => (
          <Line
            key={c.creativeId}
            type="monotone"
            dataKey={c.creativeId}
            name={c.name}
            stroke={c.color}
            strokeWidth={group ? 2.2 : 1.8}
            dot={false}
            // No connectNulls: a filled gap day carries null ratios and the
            // line must break there (before a creative's span, too).
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
    <ChartShell ariaLabel="By creative over time — expanded" legend={legend}>
      {({ inFull, toggleExpand }) => (
        <>
          {header(inFull, toggleExpand)}
          <div className={(inFull ? "flex-1 min-h-0" : "h-80") + " relative"}>
            {data.length === 0 ? empty : chart}
            {data.length > 0 && <ChartFitToggle fit={fit} />}
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
    <ChartTooltip className="max-w-[18rem]">
      <div className="text-ink-2 mb-1.5">
        {monthDay(label)} · {metricLabel}
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
    </ChartTooltip>
  );
}
