"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo, useState } from "react";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { int, intCompact, monthDay, pct, roas, usd, usdCompact } from "@/lib/format";
import { MetricPicker } from "@/components/charts/metric-picker";
import { SeriesLegend } from "@/components/charts/series-legend";
import {
  ChartShell,
  ExpandButton,
  SmoothToggle,
  GroupToggle,
} from "@/components/charts/chart-shell";
import { smoothColumns } from "@/lib/chart-smooth";
import { useChartFit, ChartFitToggle } from "@/components/charts/chart-fit";
import type { DailyMetricRow } from "@/db/queries/performance";
import { ChartTooltip } from "@/components/charts/chart-tooltip";

interface Props {
  rows: DailyMetricRow[];
  /** Heading shown inline with the metric pills. */
  title?: string;
}

type MetricKey =
  | "spend"
  | "conversions"
  | "conversionValue"
  | "cpa"
  | "roas"
  | "cpm"
  | "ctr"
  | "voc"
  | "cvr";

interface MetricDef {
  key: MetricKey;
  label: string;
  get: (r: DailyMetricRow) => number | null;
  /** Tooltip / point value formatter. */
  fmt: (v: number | null) => string;
  /** Y-axis tick formatter. */
  axis: (v: number) => string;
  /** Additive metrics sum when grouped; ratio metrics need a `weight`. */
  additive: boolean;
  /** Denominator for a ratio → correct weighted Group recombination. */
  weight?: (r: DailyMetricRow) => number | null;
}

const METRICS: MetricDef[] = [
  { key: "spend", label: "Spend", get: (r) => r.spend, fmt: usd, axis: (v) => usdCompact(v), additive: true },
  { key: "conversions", label: "Conversions", get: (r) => r.conversions, fmt: int, axis: (v) => intCompact(v), additive: true },
  { key: "conversionValue", label: "Revenue", get: (r) => r.conversionValue, fmt: usd, axis: (v) => usdCompact(v), additive: true },
  { key: "cpa", label: "CPA", get: (r) => r.cpa, fmt: usd, axis: (v) => usdCompact(v), additive: false, weight: (r) => r.conversions },
  { key: "roas", label: "ROAS", get: (r) => r.roas, fmt: (v) => roas(v), axis: (v) => roas(v), additive: false, weight: (r) => r.spend },
  { key: "cpm", label: "CPM", get: (r) => r.cpm, fmt: usd, axis: (v) => usdCompact(v), additive: false, weight: (r) => r.impressions },
  { key: "ctr", label: "CTR", get: (r) => r.ctr, fmt: pct, axis: (v) => pct(v), additive: false, weight: (r) => r.impressions },
  { key: "voc", label: "VOC", get: (r) => r.voc, fmt: pct, axis: (v) => pct(v), additive: false, weight: (r) => r.clicks },
  { key: "cvr", label: "CvR", get: (r) => r.cvr, fmt: pct, axis: (v) => pct(v), additive: false, weight: (r) => r.landingPageViews },
];

/** Combine the rows of one date into a single value for the chosen metric. */
function aggregate(def: MetricDef, rs: DailyMetricRow[]): number | null {
  if (def.additive) {
    let sum = 0;
    let any = false;
    for (const r of rs) {
      const v = def.get(r);
      if (typeof v === "number") {
        sum += v;
        any = true;
      }
    }
    return any ? sum : null;
  }
  let num = 0;
  let den = 0;
  for (const r of rs) {
    const v = def.get(r);
    const w = def.weight ? def.weight(r) : null;
    if (typeof v === "number" && typeof w === "number") {
      num += v * w;
      den += w;
    }
  }
  return den > 0 ? num / den : null;
}

interface PivotRow {
  date: string;
  [series: string]: number | string | null;
}

export function CreativePerfLineChart({
  rows,
  title = "Performance over time",
}: Props) {
  const [metricKey, setMetricKey] = useState<MetricKey>("spend");
  const [smooth, setSmooth] = useState(false);
  const [group, setGroup] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const metric = METRICS.find((m) => m.key === metricKey) ?? METRICS[0]!;

  const presentPlatforms = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.platform);
    return ALL_PLATFORMS.filter((p) => set.has(p));
  }, [rows]);

  const shown = useMemo(
    () => new Set(presentPlatforms.filter((p) => !hidden.has(p))),
    [presentPlatforms, hidden],
  );
  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // The lines drawn: one combined line when grouped, else the shown platforms.
  const lineSpecs = useMemo<Array<{ id: string; color: string; label: string }>>(() => {
    if (group) {
      return [{ id: "all", color: "var(--brand)", label: "All platforms" }];
    }
    return presentPlatforms
      .filter((p) => !hidden.has(p))
      .map((p) => ({ id: p, color: PLATFORM_COLOR[p], label: PLATFORM_LABEL[p] }));
  }, [group, presentPlatforms, hidden]);

  const labelById = useMemo(
    () => new Map(lineSpecs.map((l) => [l.id, l.label])),
    [lineSpecs],
  );

  const data = useMemo<PivotRow[]>(() => {
    if (rows.length === 0) return [];
    const byDate = new Map<string, PivotRow>();
    if (group) {
      const rowsByDate = new Map<string, DailyMetricRow[]>();
      for (const r of rows) {
        if (!shown.has(r.platform)) continue;
        const arr = rowsByDate.get(r.date);
        if (arr) arr.push(r);
        else rowsByDate.set(r.date, [r]);
      }
      for (const [date, rs] of rowsByDate) byDate.set(date, { date, all: aggregate(metric, rs) });
    } else {
      for (const r of rows) {
        let e = byDate.get(r.date);
        if (!e) {
          e = { date: r.date };
          for (const p of presentPlatforms) e[p] = null;
          byDate.set(r.date, e);
        }
        e[r.platform] = metric.get(r);
      }
    }
    const out = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    return smooth ? smoothColumns(out, lineSpecs.map((l) => l.id)) : out;
  }, [rows, metric, group, smooth, shown, presentPlatforms, lineSpecs]);

  const yValues = useMemo(() => {
    const out: number[] = [];
    for (const row of data)
      for (const l of lineSpecs) {
        const v = row[l.id];
        if (typeof v === "number") out.push(v);
      }
    return out;
  }, [data, lineSpecs]);
  const fit = useChartFit(yValues);

  return (
    <ChartShell ariaLabel={`${title} — expanded`}>
      {({ inFull, toggleExpand }) => (
        <div className={inFull ? "flex flex-col h-full gap-3" : "space-y-3"}>
          <div className="flex items-start justify-between gap-x-4 gap-y-2 flex-wrap">
            <h3 className="text-sm font-medium text-ink shrink-0 leading-7">{title}</h3>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <MetricPicker
                options={METRICS.map((m) => ({ value: m.key, label: m.label }))}
                value={metricKey}
                onChange={setMetricKey}
              />
              <GroupToggle on={group} onToggle={() => setGroup((v) => !v)} />
              <SmoothToggle on={smooth} onToggle={() => setSmooth((v) => !v)} />
              <ExpandButton inFull={inFull} onClick={toggleExpand} />
            </div>
          </div>

          {/* Legend — click a platform to hide it (and drop it from a group). */}
          {presentPlatforms.length > 1 && (
            <SeriesLegend
              items={presentPlatforms.map((p) => ({
                key: p,
                label: PLATFORM_LABEL[p],
                color: PLATFORM_COLOR[p],
              }))}
              shown={shown}
              onToggle={toggle}
            />
          )}

          {data.length === 0 ? (
            <div
              className={
                (inFull ? "flex-1 min-h-0" : "h-72") +
                " flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md"
              }
            >
              No performance records for this creative.
            </div>
          ) : (
            <div className={(inFull ? "flex-1 min-h-0" : "h-72") + " relative"}>
              <ChartFitToggle fit={fit} />
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => monthDay(d)}
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                    tickMargin={6}
                  />
                  <YAxis
                    tickFormatter={(v: number) => metric.axis(v)}
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                    width={56}
                    domain={fit.clip ? [0, fit.cap] : undefined}
                    allowDataOverflow={fit.clip}
                  />
                  <Tooltip
                    content={
                      <LineTooltip
                        fmt={metric.fmt}
                        metricLabel={metric.label}
                        labelByKey={labelById}
                      />
                    }
                  />
                  {lineSpecs.map((l) => (
                    <Line
                      key={l.id}
                      type="monotone"
                      dataKey={l.id}
                      stroke={l.color}
                      strokeWidth={group ? 2.2 : 2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </ChartShell>
  );
}

interface TooltipPayloadEntry {
  dataKey: string;
  value: number | null;
  color: string;
}

function LineTooltip({
  active,
  payload,
  label,
  fmt,
  metricLabel,
  labelByKey,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  /** The date — recharts passes the X value as `label`. */
  label?: string;
  fmt: (v: number | null) => string;
  metricLabel: string;
  labelByKey: Map<string, string>;
}) {
  if (!active || !payload || payload.length === 0 || !label) return null;
  return (
    <ChartTooltip>
      <div className="text-ink-2 mb-1.5">
        {monthDay(label)} · {metricLabel}
      </div>
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 min-w-[160px]">
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: p.color }}
            />
            <span className="text-ink-2">{labelByKey.get(p.dataKey) ?? p.dataKey}</span>
            <span className="ml-auto text-ink num">{fmt(p.value)}</span>
          </div>
        ))}
      </div>
    </ChartTooltip>
  );
}
