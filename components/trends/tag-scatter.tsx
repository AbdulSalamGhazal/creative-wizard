"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { int, pct, ratio, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TagRollupRow } from "@/db/queries/trends";

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

type YMetric = "cpa" | "roas" | "cvr";
const Y: Record<YMetric, { label: string; fmt: (v: number | null) => string; tick: (v: number) => string }> = {
  cpa: { label: "CPA", fmt: (v) => (v === null ? "—" : usd(v)), tick: (v) => compactUsd.format(v) },
  roas: { label: "ROAS", fmt: (v) => (v === null ? "—" : `${ratio(v)}×`), tick: (v) => `${ratio(v)}×` },
  cvr: { label: "CvR", fmt: pct, tick: (v) => pct(v) },
};

/**
 * Each dot is a tag: X = spend, Y = the chosen efficiency metric, bubble =
 * number of creatives carrying the tag. Spot the efficient tags vs the
 * big-spend-but-mediocre ones at a glance. Click a dot to open the Library
 * filtered to that tag.
 */
export function TagScatter({ rows }: { rows: TagRollupRow[] }) {
  const router = useRouter();
  const [metric, setMetric] = useState<YMetric>("roas");
  const y = Y[metric];

  const data = useMemo(
    () =>
      rows
        .filter((r) => r[metric] !== null && r.spend > 0)
        .map((r) => ({
          x: r.spend,
          y: r[metric] as number,
          z: Math.max(r.creatives, 1),
          tag: r.tag,
          creatives: r.creatives,
          cpa: r.cpa,
          roas: r.roas,
        })),
    [rows, metric],
  );

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="text-sm text-ink-2">Spend vs {y.label}</h3>
          <p className="text-[10px] text-ink-3">
            Each dot is a tag · bubble = creatives · click to open the Library
          </p>
        </div>
        <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-xs">
          {(Object.keys(Y) as YMetric[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setMetric(k)}
              className={cn(
                "px-2.5 py-1 rounded transition-colors",
                metric === k ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
              )}
            >
              {Y[k].label}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-72 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
          No tags to plot in this window.
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="x"
                name="Spend"
                tickFormatter={(v) => compactUsd.format(v)}
                tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                stroke="var(--line-2)"
              />
              <YAxis
                type="number"
                dataKey="y"
                name={y.label}
                tickFormatter={y.tick}
                tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                stroke="var(--line-2)"
                width={56}
              />
              <ZAxis type="number" dataKey="z" range={[50, 460]} />
              {metric === "roas" && (
                <ReferenceLine
                  y={1}
                  stroke="var(--ink-3)"
                  strokeDasharray="4 4"
                  label={{ value: "break-even", fill: "var(--ink-3)", fontSize: 10, position: "insideTopRight" }}
                />
              )}
              <Tooltip
                cursor={{ strokeDasharray: "3 3", stroke: "var(--line-2)" }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0]?.payload as {
                    tag: string; x: number; creatives: number; cpa: number | null; roas: number | null;
                  };
                  return (
                    <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-lg shadow-black/30 text-xs max-w-xs">
                      <div className="text-ink font-medium mb-1 truncate">#{p.tag}</div>
                      <Row label="Spend" value={usd(p.x)} />
                      <Row label="Creatives" value={int(p.creatives)} />
                      <Row label="CPA" value={p.cpa === null ? "—" : usd(p.cpa)} />
                      <Row label="ROAS" value={p.roas === null ? "—" : `${ratio(p.roas)}×`} />
                      <div className="mt-1 text-[10px] text-ink-3">Click to open Library</div>
                    </div>
                  );
                }}
              />
              <Scatter
                data={data}
                fill="var(--brand)"
                fillOpacity={0.65}
                className="cursor-pointer"
                onClick={(d: { tag?: string }) => {
                  if (d?.tag) router.push(`/creatives?tags=${encodeURIComponent(d.tag)}`);
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
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
