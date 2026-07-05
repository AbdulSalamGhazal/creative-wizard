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
import { type ReactNode, useMemo, useState } from "react";
import { usd, roas, pct, int, usdCompact, monthDay } from "@/lib/format";
import { seriesColor } from "@/lib/palette";
import { useChartFit, ChartFitToggle } from "@/components/charts/chart-fit";
import { SeriesLegend } from "@/components/charts/series-legend";
import {
  ChartShell,
  ExpandButton,
  SmoothToggle,
} from "@/components/charts/chart-shell";
import { smoothColumns } from "@/lib/chart-smooth";
import type { CompareMetric, CompareSeriesPoint } from "@/db/queries/performance";
import { ChartTooltip } from "@/components/charts/chart-tooltip";

interface SideOption {
  id: string;
  name: string;
}

interface Props {
  rows: CompareSeriesPoint[];
  /** One entry per side; `id` matches the rows' creativeId tag. */
  creatives: SideOption[];
  metric: CompareMetric;
  /**
   * Day-aligned mode for sides with different time windows: each side is
   * re-anchored to its own first data day ("D1", "D2", …) so a May week can
   * overlay a June week. The tooltip shows each side's real calendar date.
   */
  align?: boolean;
  /** Block header (metric switch / remove) rendered in the chart's top row. */
  header?: ReactNode;
}

// The five compare sides read from the shared, theme-aware series palette
// (lib/palette) — the old literals mixed the --pos green (read as "positive")
// with two near-identical greens. Index-keyed so a side keeps its color.
const COLORS = [0, 1, 2, 3, 4].map(seriesColor);

const DAY_MS = 86_400_000;
/** Whole days between two ISO dates (UTC-midnight parse, so no DST drift). */
function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}
function addDaysIso(a: string, n: number): string {
  return new Date(Date.parse(a) + n * DAY_MS).toISOString().slice(0, 10);
}

function fmt(metric: CompareMetric, v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  switch (metric) {
    case "spend":
    case "cpm":
    case "cpc":
    case "cpa":
      return usd(v);
    case "ctr":
    case "cvr":
    case "hookRate":
      return pct(v);
    case "roas":
      return roas(v);
    case "impressions":
    case "clicks":
    case "conversions":
      return int(v);
  }
}

export function CompareChart({
  rows,
  creatives,
  metric,
  align = false,
  header,
}: Props) {
  type ChartRow = Record<string, string | number | null>;

  const [smooth, setSmooth] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  // Stable color per side id — so a side keeps its color even when others are
  // hidden, and the legend chip matches its line.
  const colorById = useMemo(
    () =>
      new Map(creatives.map((c, i) => [c.id, COLORS[i % COLORS.length]!])),
    [creatives],
  );

  const shown = useMemo(
    () => new Set(creatives.filter((c) => !hidden.has(c.id)).map((c) => c.id)),
    [creatives, hidden],
  );
  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const shownSides = useMemo(
    () => creatives.filter((c) => shown.has(c.id)),
    [creatives, shown],
  );

  // In aligned mode each side is anchored to ITS OWN first data day; we keep
  // the anchor around so the tooltip can recover real calendar dates.
  const firstDateBySide = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      const cur = m.get(r.creativeId);
      if (!cur || r.date < cur) m.set(r.creativeId, r.date);
    }
    return m;
  }, [rows]);

  const xKey = align ? "day" : "date";

  const data = useMemo<ChartRow[]>(() => {
    const byX = new Map<string | number, ChartRow>();
    for (const r of rows) {
      if (!shown.has(r.creativeId)) continue;
      // Calendar-gap-preserving day index (D1 = the side's first data day).
      const x = align
        ? diffDays(firstDateBySide.get(r.creativeId) ?? r.date, r.date) + 1
        : r.date;
      const existing = byX.get(x);
      if (existing) {
        existing[r.creativeId] = r.value;
        continue;
      }
      const fresh: ChartRow = { [xKey]: x };
      for (const c of shownSides) fresh[c.id] = null;
      fresh[r.creativeId] = r.value;
      byX.set(x, fresh);
    }
    const out = [...byX.values()].sort((a, b) =>
      align
        ? Number(a.day) - Number(b.day)
        : String(a.date).localeCompare(String(b.date)),
    );
    return smooth ? smoothColumns(out, shownSides.map((c) => c.id)) : out;
  }, [rows, shownSides, shown, align, firstDateBySide, xKey, smooth]);

  const yValues = useMemo(() => {
    const out: number[] = [];
    for (const row of data)
      for (const c of shownSides) {
        const v = row[c.id];
        if (typeof v === "number") out.push(v);
      }
    return out;
  }, [data, shownSides]);
  const fit = useChartFit(yValues);

  return (
    <ChartShell ariaLabel={`Compare ${metric} — expanded`}>
      {({ inFull, toggleExpand }) => (
        <div className={inFull ? "flex flex-col h-full gap-3" : "space-y-3"}>
          <div className="flex items-start justify-between gap-x-4 gap-y-2 flex-wrap">
            <div className="min-w-0">{header}</div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <SmoothToggle on={smooth} onToggle={() => setSmooth((v) => !v)} />
              <ExpandButton inFull={inFull} onClick={toggleExpand} />
            </div>
          </div>

          {/* Legend — click a side to hide its line. */}
          {creatives.length > 1 && (
            <SeriesLegend
              items={creatives.map((c) => ({
                key: c.id,
                label: c.name,
                color: colorById.get(c.id) ?? seriesColor(0),
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
              No data for this selection in the chosen window.
            </div>
          ) : (
            <div className={(inFull ? "flex-1 min-h-0" : "h-72") + " relative"}>
              <ChartFitToggle fit={fit} />
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data}
                  margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    stroke="var(--line)"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey={xKey}
                    tickFormatter={(d: string | number) =>
                      align ? `D${d}` : monthDay(String(d))
                    }
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                    tickMargin={6}
                  />
                  <YAxis
                    tickFormatter={(v: number) =>
                      metric === "spend" ||
                      metric === "cpm" ||
                      metric === "cpc" ||
                      metric === "cpa"
                        ? usdCompact(v)
                        : metric === "ctr" ||
                            metric === "cvr" ||
                            metric === "hookRate"
                          ? `${(v * 100).toFixed(1)}%`
                          : v >= 1000
                            ? `${(v / 1000).toFixed(1)}k`
                            : String(v)
                    }
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                    width={56}
                    domain={fit.clip ? [0, fit.cap] : undefined}
                    allowDataOverflow={fit.clip}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (
                        !active ||
                        !payload ||
                        label === undefined ||
                        label === null
                      )
                        return null;
                      return (
                        <ChartTooltip>
                          <div className="text-ink-2 mb-1.5">
                            {align
                              ? `Day ${label}`
                              : monthDay(label as string)}
                          </div>
                          <div className="space-y-1">
                            {payload.map((p) => {
                              const c = creatives.find((c) => c.id === p.dataKey);
                              // Aligned mode: recover this side's real calendar
                              // date for the hovered day index.
                              const anchor = align
                                ? firstDateBySide.get(String(p.dataKey))
                                : undefined;
                              const sideDate = anchor
                                ? monthDay(addDaysIso(anchor, Number(label) - 1))
                                : null;
                              return (
                                <div
                                  key={String(p.dataKey)}
                                  className="flex items-center gap-2 min-w-[200px]"
                                >
                                  <span
                                    className="w-2 h-2 rounded-sm shrink-0"
                                    style={{ background: p.color }}
                                  />
                                  <span className="text-ink-2 truncate max-w-[130px]">
                                    {c?.name ?? p.dataKey}
                                    {sideDate && (
                                      <span className="text-ink-3">
                                        {" "}
                                        · {sideDate}
                                      </span>
                                    )}
                                  </span>
                                  <span className="ml-auto text-ink num">
                                    {fmt(metric, p.value as number | null)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </ChartTooltip>
                      );
                    }}
                  />
                  {shownSides.map((c) => (
                    <Line
                      key={c.id}
                      type="monotone"
                      dataKey={c.id}
                      stroke={colorById.get(c.id) ?? seriesColor(0)}
                      strokeWidth={2}
                      dot={{
                        r: 2.5,
                        fill: colorById.get(c.id) ?? seriesColor(0),
                        strokeWidth: 0,
                      }}
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

export { COLORS as COMPARE_COLORS };
