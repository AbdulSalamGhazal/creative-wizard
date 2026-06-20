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
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FunnelDailyPoint } from "@/db/queries/funnel";

type MetricKey = "ctr" | "voc" | "atcRate" | "apRate" | "purchaseRate" | "cvr";

const METRICS: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: "ctr", label: "CTR", color: "#60A5FA" },
  { key: "voc", label: "VOC", color: "#34D399" },
  { key: "atcRate", label: "ATC", color: "#22D3EE" },
  { key: "apRate", label: "AP", color: "#F472B6" },
  { key: "purchaseRate", label: "CvR (AP)", color: "#FB923C" },
  { key: "cvr", label: "CvR (LP)", color: "#A78BFA" },
];

const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

interface Row {
  date: string;
  [k: string]: number | string | null;
}

/**
 * Funnel conversion-rates over time. Every funnel step plots as a line (all are
 * %, so they share one axis); click a legend chip to toggle a line off. The "vs
 * prev" switch overlays the prior equal-length window for the shown metrics as
 * dashed lines (aligned by relative day).
 */
export function FunnelTrendChart({
  points,
  prevPoints,
}: {
  points: FunnelDailyPoint[];
  prevPoints: FunnelDailyPoint[];
}) {
  const [shown, setShown] = useState<Set<MetricKey>>(
    () => new Set(METRICS.map((m) => m.key)),
  );
  const [compare, setCompare] = useState(false);

  const data = useMemo<Row[]>(
    () =>
      points.map((cur, i) => {
        const prv = prevPoints[i];
        const row: Row = { date: cur.date };
        for (const m of METRICS) {
          row[m.key] = cur[m.key];
          row[`${m.key}_prev`] = prv ? prv[m.key] : null;
        }
        return row;
      }),
    [points, prevPoints],
  );

  const toggle = (k: MetricKey) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const visible = METRICS.filter((m) => shown.has(m.key));

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="text-sm text-ink-2">Funnel rates over time</h3>
          <p className="text-[10px] text-ink-3">
            Click a metric to hide it. Toggle &ldquo;vs prev&rdquo; to overlay the
            prior period (dashed).
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCompare((v) => !v)}
          aria-pressed={compare}
          className={cn(
            "h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors",
            compare
              ? "border-brand/50 bg-[var(--brand-soft)] text-ink"
              : "border-line text-ink-2 hover:text-ink hover:bg-surface-2",
          )}
        >
          vs prev period
        </button>
      </div>

      {/* Legend / metric toggles */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {METRICS.map((m) => {
          const on = shown.has(m.key);
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => toggle(m.key)}
              aria-pressed={on}
              className={cn(
                "inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] transition-colors",
                on
                  ? "border-line bg-surface-2 text-ink"
                  : "border-line text-ink-3 hover:text-ink line-through opacity-60",
              )}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: m.color }}
              />
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="h-72">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
            No data in this window.
          </div>
        ) : (
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
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                stroke="var(--line-2)"
                width={44}
              />
              <Tooltip
                content={<FunnelTip visible={visible} compare={compare} />}
              />
              {visible.map((m) => (
                <Line
                  key={m.key}
                  type="monotone"
                  dataKey={m.key}
                  name={m.label}
                  stroke={m.color}
                  strokeWidth={1.8}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
              {compare &&
                visible.map((m) => (
                  <Line
                    key={`${m.key}_prev`}
                    type="monotone"
                    dataKey={`${m.key}_prev`}
                    stroke={m.color}
                    strokeWidth={1.4}
                    strokeDasharray="4 3"
                    strokeOpacity={0.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function FunnelTip({
  active,
  label,
  payload,
  visible,
  compare,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ dataKey: string; value: number | null }>;
  visible: Array<{ key: MetricKey; label: string; color: string }>;
  compare: boolean;
}) {
  if (!active || !payload || payload.length === 0 || !label) return null;
  const byKey = new Map(payload.map((p) => [p.dataKey, p.value]));
  return (
    <div className="rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
      <div className="text-ink-2 mb-1.5">{monthDay.format(new Date(label))}</div>
      <div className="space-y-1">
        {visible.map((m) => (
          <div key={m.key} className="flex items-center gap-2 min-w-[150px]">
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: m.color }}
            />
            <span className="text-ink-2">{m.label}</span>
            <span className="ml-auto text-ink num">{pct(byKey.get(m.key) ?? null)}</span>
            {compare && (
              <span className="text-ink-3 num w-12 text-right">
                {pct(byKey.get(`${m.key}_prev`) ?? null)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
