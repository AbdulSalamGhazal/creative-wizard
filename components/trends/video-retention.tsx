"use client";

import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import type { VideoDiagnosticRow, VideoFunnel } from "@/db/queries/trends";

type Norm = "impr" | "hook";
type Mode = "portfolio" | "byVideo";

const STAGES_IMPR = ["Impr", "2s", "25%", "50%", "75%", "100%"] as const;
const STAGES_HOOK = ["2s", "25%", "50%", "75%", "100%"] as const;

// Distinct line colors for the per-video overlay.
const SERIES_COLORS = [
  "#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa",
  "#22d3ee", "#fb923c", "#4ade80",
];

const TOP_N = 8;

/** Retention percentages for one funnel under a normalization. */
function curveValues(f: VideoFunnel, norm: Norm): number[] {
  if (norm === "impr") {
    const b = f.impressions || 1;
    return [100, (f.v2s / b) * 100, (f.v25 / b) * 100, (f.v50 / b) * 100, (f.v75 / b) * 100, (f.v100 / b) * 100];
  }
  const b = f.v2s || 1;
  return [100, (f.v25 / b) * 100, (f.v50 / b) * 100, (f.v75 / b) * 100, (f.v100 / b) * 100];
}

/**
 * Video retention curve — the core completion diagnostic. Plots the audience
 * surviving each stage (impressions → 2s → 25/50/75/100%). Toggle the
 * normalization (share of impressions = reach, share of 2s = holding power)
 * and switch between the blended portfolio curve and the top videos overlaid.
 */
export function VideoRetention({
  aggregate,
  rows,
}: {
  aggregate: VideoFunnel;
  rows: VideoDiagnosticRow[];
}) {
  const [mode, setMode] = useState<Mode>("portfolio");
  const [norm, setNorm] = useState<Norm>("hook");

  const stages = norm === "impr" ? STAGES_IMPR : STAGES_HOOK;
  const topVideos = useMemo(
    () => rows.filter((r) => r.v2s > 0).slice(0, TOP_N),
    [rows],
  );

  const { data, insight } = useMemo(() => {
    if (mode === "portfolio") {
      const vals = curveValues(aggregate, norm);
      const d = stages.map((stage, i) => ({ stage, portfolio: vals[i] }));
      // Biggest stage-to-stage drop (the diagnosis).
      let worst = { from: "", to: "", drop: 0 };
      for (let i = 1; i < vals.length; i++) {
        const drop = (vals[i - 1] ?? 0) - (vals[i] ?? 0);
        if (drop > worst.drop) worst = { from: stages[i - 1]!, to: stages[i]!, drop };
      }
      return { data: d, insight: worst.drop > 0 ? worst : null };
    }
    const perVideo = topVideos.map((v) => curveValues(v, norm));
    const d = stages.map((stage, i) => {
      const row: Record<string, number | string> = { stage };
      topVideos.forEach((v, vi) => { row[v.creativeId] = perVideo[vi]![i]!; });
      return row;
    });
    return { data: d, insight: null };
  }, [mode, norm, aggregate, topVideos, stages]);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="text-sm text-ink-2">Retention curve</h3>
          <p className="text-[10px] text-ink-3">
            {norm === "hook"
              ? "Share of 2-second viewers surviving each quartile — holding power."
              : "Share of impressions reaching each stage — full reach funnel."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Toggle
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={[{ k: "portfolio", label: "Portfolio" }, { k: "byVideo", label: "Top videos" }]}
          />
          <Toggle
            value={norm}
            onChange={(v) => setNorm(v as Norm)}
            options={[{ k: "hook", label: "% of 2s" }, { k: "impr", label: "% of impr" }]}
          />
        </div>
      </div>

      {insight && (
        <div className="mb-2 text-[11px] text-ink-2">
          Biggest drop-off:{" "}
          <span className="text-neg font-medium">
            {insight.from} → {insight.to} (−{insight.drop.toFixed(0)} pts)
          </span>
        </div>
      )}

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="stage" tick={{ fill: "var(--ink-3)", fontSize: 11 }} stroke="var(--line-2)" />
            <YAxis
              tickFormatter={(v) => `${v}%`}
              domain={[0, 100]}
              tick={{ fill: "var(--ink-3)", fontSize: 11 }}
              stroke="var(--line-2)"
              width={40}
            />
            <Tooltip
              cursor={{ stroke: "var(--line-2)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                return (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-lg shadow-black/30 text-xs max-w-[16rem]">
                    <div className="text-ink font-medium mb-1">{label}</div>
                    {payload.slice(0, 8).map((p) => (
                      <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
                        <span className="inline-flex items-center gap-1.5 text-ink-2 truncate">
                          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                          {mode === "portfolio" ? "Retained" : labelFor(topVideos, String(p.dataKey))}
                        </span>
                        <span className="tabular-nums text-ink">{(p.value as number).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {mode === "portfolio" ? (
              <Area
                type="monotone"
                dataKey="portfolio"
                stroke="var(--brand)"
                fill="var(--brand)"
                fillOpacity={0.14}
                strokeWidth={2}
                dot={{ r: 3, fill: "var(--brand)" }}
              />
            ) : (
              topVideos.map((v, i) => (
                <Line
                  key={v.creativeId}
                  type="monotone"
                  dataKey={v.creativeId}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={1.75}
                  dot={false}
                  connectNulls
                />
              ))
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {mode === "byVideo" && topVideos.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap mt-2">
          {topVideos.map((v, i) => (
            <span key={v.creativeId} className="inline-flex items-center gap-1.5 text-[10px] text-ink-2 max-w-[12rem]">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              <span className="truncate">{v.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function labelFor(rows: VideoDiagnosticRow[], id: string): string {
  return rows.find((r) => r.creativeId === id)?.name ?? id;
}

function Toggle({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { k: string; label: string }[];
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => onChange(o.k)}
          className={cn(
            "px-2.5 py-1 rounded transition-colors",
            value === o.k ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
