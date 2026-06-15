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
import { int, intCompact, pct, ratio, usd, usdCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DailyMetricRow } from "@/db/queries/performance";

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
}

const METRICS: MetricDef[] = [
  { key: "spend", label: "Spend", get: (r) => r.spend, fmt: usd, axis: (v) => usdCompact(v) },
  { key: "conversions", label: "Conversions", get: (r) => r.conversions, fmt: int, axis: (v) => intCompact(v) },
  { key: "conversionValue", label: "Revenue", get: (r) => r.conversionValue, fmt: usd, axis: (v) => usdCompact(v) },
  { key: "cpa", label: "CPA", get: (r) => r.cpa, fmt: usd, axis: (v) => usdCompact(v) },
  { key: "roas", label: "ROAS", get: (r) => r.roas, fmt: (v) => (v === null ? "—" : `${ratio(v)}×`), axis: (v) => `${ratio(v)}×` },
  { key: "cpm", label: "CPM", get: (r) => r.cpm, fmt: usd, axis: (v) => usdCompact(v) },
  { key: "ctr", label: "CTR", get: (r) => r.ctr, fmt: pct, axis: (v) => pct(v) },
  { key: "voc", label: "VOC", get: (r) => r.voc, fmt: pct, axis: (v) => pct(v) },
  { key: "cvr", label: "CvR", get: (r) => r.cvr, fmt: pct, axis: (v) => pct(v) },
];

interface PivotRow {
  date: string;
  instagram: number | null;
  facebook: number | null;
  tiktok: number | null;
  snapchat: number | null;
}

const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function CreativePerfLineChart({
  rows,
  title = "Performance over time",
}: Props) {
  const [metricKey, setMetricKey] = useState<MetricKey>("spend");
  const metric = METRICS.find((m) => m.key === metricKey) ?? METRICS[0]!;

  const data = useMemo<PivotRow[]>(() => {
    if (rows.length === 0) return [];
    const byDate = new Map<string, PivotRow>();
    for (const r of rows) {
      let existing = byDate.get(r.date);
      if (!existing) {
        existing = {
          date: r.date,
          instagram: null,
          facebook: null,
          tiktok: null,
          snapchat: null,
        };
        byDate.set(r.date, existing);
      }
      existing[r.platform] = metric.get(r);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows, metric]);

  const presentPlatforms = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.platform);
    return ALL_PLATFORMS.filter((p) => set.has(p));
  }, [rows]);

  return (
    <div className="space-y-3">
      {/* Title + metric selector share one row — the title pins left, the pills
          fill the rest and wrap within their own block (never onto a row of
          their own). */}
      <div className="flex items-start justify-between gap-x-4 gap-y-2">
        <h3 className="text-sm font-medium text-ink shrink-0 leading-7">{title}</h3>
        <div className="flex flex-wrap justify-end gap-1.5">
          {METRICS.map((m) => {
            const active = m.key === metricKey;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetricKey(m.key)}
                aria-pressed={active}
                className={cn(
                  "h-7 px-3 rounded-md text-xs border transition-colors",
                  active
                    ? "border-brand/50 bg-[var(--brand-soft)] text-ink font-medium"
                    : "border-line text-ink-2 hover:text-ink hover:bg-surface-2",
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-72 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
          No performance records for this creative.
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => monthDay.format(new Date(d))}
                tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                stroke="var(--line-2)"
                tickMargin={6}
              />
              <YAxis
                tickFormatter={(v: number) => metric.axis(v)}
                tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                stroke="var(--line-2)"
                width={56}
              />
              <Tooltip content={<LineTooltip fmt={metric.fmt} metricLabel={metric.label} />} />
              {presentPlatforms.map((p) => (
                <Line
                  key={p}
                  type="monotone"
                  dataKey={p}
                  stroke={PLATFORM_COLOR[p]}
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: PLATFORM_COLOR[p], strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive
                  animationDuration={700}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
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
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  /** The date — recharts passes the X value as `label`. */
  label?: string;
  fmt: (v: number | null) => string;
  metricLabel: string;
}) {
  if (!active || !payload || payload.length === 0 || !label) return null;
  return (
    <div className="rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
      <div className="text-ink-2 mb-1.5">
        {monthDay.format(new Date(label))} · {metricLabel}
      </div>
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 min-w-[160px]">
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: p.color }}
            />
            <span className="text-ink-2">
              {PLATFORM_LABEL[p.dataKey as keyof typeof PLATFORM_LABEL]}
            </span>
            <span className="ml-auto text-ink num">{fmt(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
