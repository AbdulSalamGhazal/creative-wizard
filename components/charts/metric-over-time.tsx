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
import { MetricPicker } from "@/components/charts/metric-picker";
import { usd, int, ratio } from "@/lib/format";
import { useChartFit, ChartFitToggle } from "@/components/charts/chart-fit";
import type { MetricOverTimeRow } from "@/db/queries/performance";

export interface OverTimeKey {
  key: string;
  label: string;
  color: string;
}

interface Props {
  rows: MetricOverTimeRow[];
  keys: OverTimeKey[];
  dimension: "platform" | "campaign";
  /** Shown next to "by campaign" (e.g. the pinned platform's name). */
  dimensionLabel?: string;
}

type MetricKey = "spend" | "revenue" | "conversions" | "cpa" | "roas";

interface MetricDef {
  value: MetricKey;
  label: string;
  additive: boolean;
  pick: (r: MetricOverTimeRow) => number | null;
  fmt: (v: number | null) => string;
}

const METRICS: MetricDef[] = [
  { value: "spend", label: "Spend", additive: true, pick: (r) => r.spend, fmt: usd },
  { value: "revenue", label: "Revenue", additive: true, pick: (r) => r.conversionValue, fmt: usd },
  { value: "conversions", label: "Conversions", additive: true, pick: (r) => r.conversions, fmt: int },
  { value: "cpa", label: "CPA", additive: false, pick: (r) => r.cpa, fmt: usd },
  {
    value: "roas",
    label: "ROAS",
    additive: false,
    pick: (r) => r.roas,
    fmt: (v) => (v === null ? "—" : `${ratio(v)}×`),
  },
];

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const compactInt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function axisFormat(metric: MetricKey, v: number): string {
  if (metric === "conversions") return compactInt.format(v);
  if (metric === "roas") return `${ratio(v)}×`;
  return compactUsd.format(v);
}

interface PivotRow {
  date: string;
  [series: string]: number | string | null;
}

/**
 * Daily metric per dimension (platform, or campaign when a single platform is
 * filtered) as separate lines. A dropdown in the header swaps which metric is
 * plotted; the data for every metric is sent up-front so switching is instant.
 */
export function MetricOverTimeChart({ rows, keys, dimension, dimensionLabel }: Props) {
  const [metric, setMetric] = useState<MetricKey>("spend");
  const def = METRICS.find((m) => m.value === metric) ?? METRICS[0]!;
  // Recharts resolves a STRING dataKey through lodash get(), which treats "." /
  // "[" / "]" as a nested path — so a campaign name like "2.0 Launch ➤ Broad"
  // would silently plot nothing (looked up as row["2"]["0 Launch ➤ Broad"]).
  // Map every series to a safe synthetic id (s0, s1, …) used for the pivot
  // property AND the <Line dataKey>; the real name lives only in the label.
  const safeKeys = useMemo(
    () => keys.map((k, i) => ({ ...k, id: `s${i}` })),
    [keys],
  );
  const idByKey = useMemo(
    () => new Map(safeKeys.map((k) => [k.key, k.id])),
    [safeKeys],
  );
  const labelById = useMemo(
    () => new Map(safeKeys.map((k) => [k.id, k.label])),
    [safeKeys],
  );

  const data = useMemo<PivotRow[]>(() => {
    if (rows.length === 0) return [];
    const byDate = new Map<string, PivotRow>();
    for (const r of rows) {
      let e = byDate.get(r.date);
      if (!e) {
        e = { date: r.date };
        for (const k of safeKeys) e[k.id] = null;
        byDate.set(r.date, e);
      }
      const id = idByKey.get(r.key);
      if (id) e[id] = def.pick(r);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows, safeKeys, idByKey, def]);

  // Robust Y-axis: cap a lone anomaly spike so the rest stays readable.
  const yValues = useMemo(() => {
    const out: number[] = [];
    for (const row of data)
      for (const k of safeKeys) {
        const v = row[k.id];
        if (typeof v === "number") out.push(v);
      }
    return out;
  }, [data, safeKeys]);
  const fit = useChartFit(yValues);

  return (
    <div className="rounded-xl border border-line bg-surface p-4 md:p-5 space-y-3">
      {/* Header: metric picker + dimension hint */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MetricPicker
            options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
            value={metric}
            onChange={setMetric}
          />
          <span className="text-sm text-ink-2">over time</span>
        </div>
        {dimension === "campaign" && (
          <span className="text-[11px] text-ink-3">
            by campaign{dimensionLabel ? ` · ${dimensionLabel}` : ""}
          </span>
        )}
      </div>

      {/* Legend */}
      {keys.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {keys.map((k) => (
            <span
              key={k.key}
              className="inline-flex items-center gap-1.5 text-[11px] text-ink-3 max-w-[180px]"
              title={k.label}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: k.color }}
              />
              <span className="truncate">{k.label}</span>
            </span>
          ))}
        </div>
      )}

      {data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
          No data in the selected window.
        </div>
      ) : (
        <div className="h-64 relative">
          <ChartFitToggle fit={fit} />
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
                tickFormatter={(v: number) => axisFormat(metric, v)}
                tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                stroke="var(--line-2)"
                width={56}
                domain={fit.clip ? [0, fit.cap] : undefined}
                allowDataOverflow={fit.clip}
              />
              <Tooltip
                content={
                  <CustomTooltip
                    fmt={def.fmt}
                    additive={def.additive}
                    labelByKey={labelById}
                  />
                }
              />
              {safeKeys.map((k) => (
                <Line
                  key={k.id}
                  type="monotone"
                  dataKey={k.id}
                  stroke={k.color}
                  strokeWidth={1.8}
                  dot={false}
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

function CustomTooltip({
  active,
  payload,
  label,
  fmt,
  additive,
  labelByKey,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  fmt: (v: number | null) => string;
  additive: boolean;
  labelByKey: Map<string, string>;
}) {
  if (!active || !payload || payload.length === 0 || !label) return null;
  const total = payload.reduce((sum, p) => sum + (p.value ?? 0), 0);
  return (
    <div className="rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
      <div className="text-ink-2 mb-1.5">{monthDay.format(new Date(label))}</div>
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 min-w-[170px]">
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: p.color }}
            />
            <span className="text-ink-2 truncate max-w-[110px]">
              {labelByKey.get(p.dataKey) ?? p.dataKey}
            </span>
            <span className="ml-auto text-ink num">{fmt(p.value)}</span>
          </div>
        ))}
        {additive && (
          <div className="flex items-center gap-2 pt-1 mt-1 border-t border-line">
            <span className="text-ink-3">Total</span>
            <span className="ml-auto text-ink num font-semibold">{fmt(total)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
