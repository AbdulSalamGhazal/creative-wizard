"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricPicker } from "@/components/charts/metric-picker";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { swatchColor } from "@/lib/palette";
import { int, pct, roas, usd } from "@/lib/format";

/** The metrics a leaderboard can rank by. The Dashboard ranks by spend only. */
export type AngleLeaderboardMetric =
  | "spend"
  | "conversions"
  | "revenue"
  | "roas"
  | "cpa"
  | "cpm"
  | "ctr"
  | "cvr"
  | "hookRate";

/** A row the leaderboard can rank: an angle, its spend, and any other metric
 *  the caller carries (`AngleMixRow` has spend only; `AngleRollupRow` all). */
export type AngleLeaderboardRow = { angle: string; spend: number } & Partial<
  Record<Exclude<AngleLeaderboardMetric, "spend">, number | null>
>;

const METRICS: Array<{
  key: AngleLeaderboardMetric;
  label: string;
  fmt: (v: number) => string;
  /** Lower is better (CPA, CPM) — ranks ascending. */
  lower?: boolean;
}> = [
  { key: "spend", label: METRIC_LABEL.spend, fmt: usd },
  { key: "conversions", label: METRIC_LABEL.conversions, fmt: int },
  { key: "revenue", label: METRIC_LABEL.revenue, fmt: usd },
  { key: "roas", label: METRIC_LABEL.roas, fmt: (v) => roas(v) },
  { key: "cpa", label: METRIC_LABEL.cpa, fmt: usd, lower: true },
  { key: "cpm", label: METRIC_LABEL.cpm, fmt: usd, lower: true },
  { key: "ctr", label: METRIC_LABEL.ctr, fmt: (v) => pct(v) },
  { key: "cvr", label: METRIC_LABEL.cvr, fmt: (v) => pct(v) },
  { key: "hookRate", label: METRIC_LABEL.hookRate, fmt: (v) => pct(v) },
];

/**
 * THE angle leaderboard (D28, 2026-10) — ranked horizontal bars. A donut is
 * wrong for angles: a creative can carry several, so slices overlap and never
 * sum to a whole; ranked bars compare magnitudes honestly. There were two
 * components of this name (the Dashboard's top-8 by spend, and Trends'
 * top-10 with a metric picker and Library links); now one, with three props:
 * `limit`, `picker` (rank by any metric; direction-aware) and `linked` (each
 * angle opens the filtered Library). Bars wear the angle's own swatch colour.
 */
export function AngleLeaderboard({
  rows,
  title = "Angle mix",
  limit = 8,
  picker = false,
  linked = false,
}: {
  rows: AngleLeaderboardRow[];
  title?: string;
  limit?: number;
  picker?: boolean;
  linked?: boolean;
}) {
  const [metricKey, setMetricKey] = useState<AngleLeaderboardMetric>("spend");
  const metric = METRICS.find((m) => m.key === metricKey)!;

  const ranked = useMemo(() => {
    // A zero spend has nothing to rank, and a cost of 0 is no data, not a win.
    const keep = (v: number) => (metricKey === "spend" || metric.lower ? v > 0 : v >= 0);
    const top = rows
      .map((r) => ({ angle: r.angle, value: (r[metricKey] ?? null) as number | null }))
      .filter((r): r is { angle: string; value: number } => r.value !== null && keep(r.value))
      .sort((a, b) => (metric.lower ? a.value - b.value : b.value - a.value))
      .slice(0, limit);
    const max = top.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0);
    return { top, max };
  }, [rows, metricKey, metric.lower, limit]);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-sm">
          {picker ? (
            <>
              Top angles by {metric.label}
              {metric.lower && <span className="font-normal text-ink-3"> · lower is better</span>}
            </>
          ) : (
            title
          )}
        </CardTitle>
        {picker && (
          <MetricPicker
            options={METRICS.map((m) => ({ value: m.key, label: m.label }))}
            value={metricKey}
            onChange={setMetricKey}
          />
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {ranked.top.length === 0 ? (
          <EmptyState
            className="flex flex-1 flex-col items-center justify-center py-8"
            title={
              metricKey === "spend"
                ? "No spend on any angle in this window."
                : `No angles with ${metric.label} in this window.`
            }
            kind="filtered"
            buttons={false}
          />
        ) : (
          <ol className="flex flex-1 flex-col justify-around gap-2.5">
            {ranked.top.map((r, i) => {
              const width = ranked.max > 0 ? Math.max((Math.abs(r.value) / ranked.max) * 100, 2) : 0;
              const name = (
                <span className="truncate" title={r.angle}>
                  {r.angle}
                </span>
              );
              return (
                <li key={r.angle} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2 text-ink-2">
                      <span className="w-4 shrink-0 text-right tabular-nums text-ink-3">{i + 1}</span>
                      {linked ? (
                        <Link
                          href={`/library?angles=${encodeURIComponent(r.angle)}`}
                          className="flex min-w-0 text-ink transition-colors hover:text-brand"
                        >
                          {name}
                        </Link>
                      ) : (
                        name
                      )}
                    </span>
                    <span className="num shrink-0 text-ink">{metric.fmt(r.value)}</span>
                  </div>
                  <div className="ml-6 h-2 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${width}%`, background: swatchColor(r.angle) }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
