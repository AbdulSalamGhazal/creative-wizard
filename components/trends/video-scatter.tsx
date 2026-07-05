"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { pct, ratio, usd } from "@/lib/format";
import type { VideoDiagnosticRow } from "@/db/queries/trends";
import { ChartTooltip } from "@/components/charts/chart-tooltip";

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1,
});

type Axis = "hookRate" | "holdRate" | "completeRate" | "ctr" | "cvr" | "roas" | "cpa";

const M: Record<Axis, { label: string; fmt: (v: number | null) => string; tick: (v: number) => string }> = {
  hookRate: { label: "Hook rate", fmt: pct, tick: (v) => pct(v) },
  holdRate: { label: "Hold rate (50%)", fmt: pct, tick: (v) => pct(v) },
  completeRate: { label: "Complete rate", fmt: pct, tick: (v) => pct(v) },
  ctr: { label: "CTR", fmt: pct, tick: (v) => pct(v) },
  cvr: { label: "CvR", fmt: pct, tick: (v) => pct(v) },
  roas: { label: "ROAS", fmt: (v) => (v === null ? "—" : `${ratio(v)}×`), tick: (v) => `${ratio(v)}×` },
  cpa: { label: "CPA", fmt: (v) => (v === null ? "—" : usd(v)), tick: (v) => compactUsd.format(v) },
};
const AXES = Object.keys(M) as Axis[];

/**
 * Flexible two-metric diagnostic. Each dot is a video; bubble = spend. Pair
 * any two of hook/hold/complete/CTR/CvR/ROAS/CPA to ask things like
 * "do strong hooks actually finish?" (Hook × Complete) or "does finishing
 * drive returns?" (Complete × ROAS). Click a dot to open the creative.
 */
export function VideoScatter({ rows }: { rows: VideoDiagnosticRow[] }) {
  const router = useRouter();
  const [xKey, setXKey] = useState<Axis>("hookRate");
  const [yKey, setYKey] = useState<Axis>("completeRate");
  const x = M[xKey];
  const y = M[yKey];

  const data = useMemo(
    () =>
      rows
        .filter((r) => r[xKey] !== null && r[yKey] !== null && r.spend > 0)
        .map((r) => ({
          x: r[xKey] as number,
          y: r[yKey] as number,
          z: Math.max(r.spend, 1),
          name: r.name,
          spend: r.spend,
          xv: r[xKey] as number,
          yv: r[yKey] as number,
        })),
    [rows, xKey, yKey],
  );

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="text-sm text-ink-2">Diagnostic scatter</h3>
          <p className="text-[10px] text-ink-3">Each dot is a video · bubble = spend · click to open</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Pick label="Y" value={yKey} onChange={setYKey} />
          <span className="text-ink-3">vs</span>
          <Pick label="X" value={xKey} onChange={setXKey} />
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-72 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
          No videos with both metrics in this window.
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" name={x.label} tickFormatter={x.tick} tick={{ fill: "var(--ink-3)", fontSize: 11 }} stroke="var(--line-2)" />
              <YAxis type="number" dataKey="y" name={y.label} tickFormatter={y.tick} tick={{ fill: "var(--ink-3)", fontSize: 11 }} stroke="var(--line-2)" width={52} />
              <ZAxis type="number" dataKey="z" range={[40, 460]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3", stroke: "var(--line-2)" }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0]?.payload as { name: string; spend: number; xv: number; yv: number };
                  return (
                    <ChartTooltip className="max-w-xs">
                      <div className="text-ink font-medium mb-1 truncate">{p.name}</div>
                      <Row label={x.label} value={x.fmt(p.xv)} />
                      <Row label={y.label} value={y.fmt(p.yv)} />
                      <Row label="Spend" value={usd(p.spend)} />
                      <div className="mt-1 text-[10px] text-ink-3">Click to open creative</div>
                    </ChartTooltip>
                  );
                }}
              />
              <Scatter
                data={data}
                fill="var(--brand)"
                fillOpacity={0.6}
                className="cursor-pointer"
                onClick={(d: { name?: string }) => {
                  if (d?.name) router.push(`/creatives/${encodeURIComponent(d.name)}`);
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Pick({ label, value, onChange }: { label: string; value: Axis; onChange: (a: Axis) => void }) {
  return (
    <label className="inline-flex items-center gap-1">
      <span className="text-ink-3">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Axis)}
        className="h-7 rounded-md border border-line bg-surface text-xs text-ink px-1.5 focus:outline-none focus:border-brand/50"
      >
        {AXES.map((a) => (
          <option key={a} value={a}>{M[a].label}</option>
        ))}
      </select>
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-ink-2">
      <span>{label}</span>
      <span className="tabular-nums text-ink">{value}</span>
    </div>
  );
}
