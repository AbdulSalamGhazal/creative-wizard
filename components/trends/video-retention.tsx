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
import { seriesColor } from "@/lib/palette";
import type { VideoDiagnosticRow, VideoFunnel } from "@/db/queries/trends";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { ChartShell, ExpandButton } from "@/components/charts/chart-shell";
import { SeriesLegend } from "@/components/charts/series-legend";

type Norm = "impr" | "hook";
type Mode = "portfolio" | "byVideo";

const STAGES_IMPR = ["Impr", "2s", "25%", "50%", "75%", "100%"] as const;
const STAGES_HOOK = ["2s", "25%", "50%", "75%", "100%"] as const;

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
  // Hidden per-video lines (byVideo overlay); default all shown.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const stages = norm === "impr" ? STAGES_IMPR : STAGES_HOOK;
  const topVideos = useMemo(
    () => rows.filter((r) => r.v2s > 0).slice(0, TOP_N),
    [rows],
  );
  const colorOf = (id: string) =>
    seriesColor(topVideos.findIndex((v) => v.creativeId === id));
  const shownSet = useMemo(
    () =>
      new Set(
        topVideos.filter((v) => !hidden.has(v.creativeId)).map((v) => v.creativeId),
      ),
    [topVideos, hidden],
  );
  const toggleVideo = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
    <ChartShell ariaLabel="Retention curve — expanded">
      {({ inFull, toggleExpand }) => (
        <>
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
              <ExpandButton inFull={inFull} onClick={toggleExpand} />
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

          {mode === "byVideo" && topVideos.length > 0 && (
            <SeriesLegend
              className="mb-2"
              items={topVideos.map((v) => ({
                key: v.creativeId,
                label: v.name,
                color: colorOf(v.creativeId),
              }))}
              shown={shownSet}
              onToggle={toggleVideo}
            />
          )}

          <div className={inFull ? "flex-1 min-h-0" : "h-72"}>
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
                      <ChartTooltip className="max-w-[16rem]">
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
                      </ChartTooltip>
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
                  topVideos
                    .filter((v) => shownSet.has(v.creativeId))
                    .map((v) => (
                      <Line
                        key={v.creativeId}
                        type="monotone"
                        dataKey={v.creativeId}
                        stroke={colorOf(v.creativeId)}
                        strokeWidth={1.75}
                        dot={false}
                        connectNulls
                      />
                    ))
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </ChartShell>
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
