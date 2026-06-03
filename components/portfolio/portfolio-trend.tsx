"use client";

import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { int, ratio, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TrendPoint } from "@/db/queries/portfolio";

export interface TrendAnnotation {
  date: string;
  label: string;
  color: string;
  /** Minor markers (e.g. payday) render as a thin line with no label. */
  minor?: boolean;
}

type RightMetric = "cpa" | "roas" | "orders";

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const RIGHT: Record<
  RightMetric,
  { label: string; color: string; fmt: (v: number | null) => string; tick: (v: number) => string }
> = {
  cpa: { label: "CPA", color: "#f472b6", fmt: (v) => (v === null ? "—" : usd(v)), tick: (v) => compactUsd.format(v) },
  roas: { label: "ROAS", color: "#34d399", fmt: (v) => (v === null ? "—" : `${ratio(v)}×`), tick: (v) => `${ratio(v)}×` },
  orders: { label: "Orders", color: "#60a5fa", fmt: (v) => (v === null ? "—" : int(v)), tick: (v) => int(v) },
};
const ORDER: RightMetric[] = ["cpa", "roas", "orders"];

export function PortfolioTrend({
  data,
  annotations,
  targetCpa,
}: {
  data: TrendPoint[];
  annotations: TrendAnnotation[];
  targetCpa: number | null;
}) {
  const [metric, setMetric] = useState<RightMetric>("cpa");
  const r = RIGHT[metric];

  // Only annotate dates that fall inside the plotted window.
  const dates = useMemo(() => new Set(data.map((d) => d.date)), [data]);
  const marks = annotations.filter((a) => dates.has(a.date));

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface p-4">
        <Header metric={metric} setMetric={setMetric} />
        <div className="h-72 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
          No activity in this window.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <Header metric={metric} setMetric={setMetric} />
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 14, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "var(--ink-3)", fontSize: 10 }}
              stroke="var(--line-2)"
              tickFormatter={(d: string) => d.slice(5)}
              minTickGap={24}
            />
            <YAxis
              yAxisId="left"
              tick={{ fill: "var(--ink-3)", fontSize: 10 }}
              stroke="var(--line-2)"
              tickFormatter={(v: number) => compactUsd.format(v)}
              width={48}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: "var(--ink-3)", fontSize: 10 }}
              stroke="var(--line-2)"
              tickFormatter={r.tick}
              width={48}
            />

            {marks.map((m, i) => (
              <ReferenceLine
                key={`${m.date}-${i}`}
                yAxisId="left"
                x={m.date}
                stroke={m.color}
                strokeDasharray={m.minor ? "2 4" : "4 3"}
                strokeOpacity={m.minor ? 0.4 : 0.8}
                label={
                  m.minor
                    ? undefined
                    : { value: m.label, fill: m.color, fontSize: 9, position: "insideTop", angle: 0 }
                }
              />
            ))}

            {metric === "cpa" && targetCpa !== null && (
              <ReferenceLine
                yAxisId="right"
                y={targetCpa}
                stroke="var(--ink-3)"
                strokeDasharray="5 4"
                label={{ value: "target", fill: "var(--ink-3)", fontSize: 9, position: "insideBottomRight" }}
              />
            )}

            <Area
              yAxisId="left"
              type="monotone"
              dataKey="spend"
              name="Spend"
              stroke="var(--brand)"
              fill="var(--brand)"
              fillOpacity={0.12}
              strokeWidth={1.5}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="spend7"
              name="Spend (7d avg)"
              stroke="var(--brand)"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey={metric}
              name={r.label}
              stroke={r.color}
              strokeWidth={2}
              dot={false}
              connectNulls
            />

            <Tooltip
              cursor={{ stroke: "var(--line-2)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const p = payload[0]?.payload as TrendPoint;
                const ann = marks.filter((m) => m.date === label);
                return (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-lg shadow-black/30 text-xs">
                    <div className="text-ink font-medium mb-1">{label}</div>
                    <Row label="Spend" value={usd(p.spend)} />
                    <Row label="Orders" value={int(p.orders)} />
                    <Row label="Revenue" value={usd(p.revenue)} />
                    <Row label="CPA" value={p.cpa === null ? "—" : usd(p.cpa)} />
                    <Row label="ROAS" value={p.roas === null ? "—" : `${ratio(p.roas)}×`} />
                    {ann.map((a) => (
                      <div key={a.label} className="mt-1 pt-1 border-t border-line text-[11px]" style={{ color: a.color }}>
                        {a.label}
                      </div>
                    ))}
                  </div>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend marks={marks} metricColor={r.color} metricLabel={r.label} />
    </div>
  );
}

function Header({
  metric,
  setMetric,
}: {
  metric: RightMetric;
  setMetric: (m: RightMetric) => void;
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
      <div>
        <h3 className="text-sm text-ink-2">Spend & efficiency over time</h3>
        <p className="text-[10px] text-ink-3">
          Spend area + 7-day rolling average · right axis switches metric
        </p>
      </div>
      <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-xs">
        {ORDER.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setMetric(k)}
            className={cn(
              "px-2.5 py-1 rounded transition-colors",
              metric === k ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
            )}
          >
            {RIGHT[k].label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 text-ink-2">
      <span>{label}</span>
      <span className="tabular-nums text-ink">{value}</span>
    </div>
  );
}

function Legend({
  marks,
  metricColor,
  metricLabel,
}: {
  marks: TrendAnnotation[];
  metricColor: string;
  metricLabel: string;
}) {
  const kinds = new Map<string, string>();
  for (const m of marks) kinds.set(m.label.replace(/^\d+\s/, "").replace(/s$/, ""), m.color);
  return (
    <div className="flex items-center gap-3 flex-wrap mt-2 text-[11px] text-ink-2">
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-0.5" style={{ background: "var(--brand)" }} />
        Spend
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-0.5" style={{ background: metricColor }} />
        {metricLabel}
      </span>
      {[...kinds.entries()].slice(0, 6).map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}
