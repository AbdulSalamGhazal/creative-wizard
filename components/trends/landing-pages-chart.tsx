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
import { ChartHeader, ChartShell, ExpandButton } from "@/components/charts/chart-shell";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { MetricPicker } from "@/components/charts/metric-picker";
import { SeriesLegend } from "@/components/charts/series-legend";
import { ChartFitToggle, useChartFit } from "@/components/charts/chart-fit";
import { EmptyState } from "@/components/ui/empty-state";
import { dayBucketsInRange } from "@/lib/budget";
import { int, intCompact, monthDay, usd, usdCompact } from "@/lib/format";
import { landingPageLabel } from "@/lib/landing-code";
import { seriesColor } from "@/lib/palette";
import type {
  LandingPageDailyRow,
  LandingPageRollupRow,
} from "@/db/queries/landing-page-performance";

type Metric = "spend" | "conversions";

const METRICS: Record<Metric, { label: string; cell: (v: number | null) => string; axis: (v: number) => string }> = {
  spend: { label: "Spend", cell: usd, axis: usdCompact },
  conversions: { label: "Conversions", cell: int, axis: intCompact },
};
const METRIC_ORDER: Metric[] = ["spend", "conversions"];

/** A series: one landing page (the product page included). */
interface Series {
  /** The pivot property AND the <Line dataKey> — never the page's name, which
   *  Recharts would read as a lodash path (a "." in it plots nothing). */
  id: string;
  key: string;
  label: string;
  color: string;
}

interface PivotRow {
  date: string;
  [id: string]: number | string;
}

const seriesKey = (landingPageId: string | null) => landingPageId ?? "product";

/**
 * Spend (or conversions) per day, one line per landing page over the resolved
 * range. Every day in the range is a point: a day a page had no record is a
 * zero, because an absent day of an additive metric IS zero. The product
 * page draws in the neutral ink so the registered pages carry the colour.
 */
export function LandingPagesChart({
  daily,
  pages,
  from,
  to,
}: {
  daily: LandingPageDailyRow[];
  /** The per-page rollup (unsplit) — names the series and orders them by spend. */
  pages: LandingPageRollupRow[];
  from: string;
  to: string;
}) {
  const [metric, setMetric] = useState<Metric>("spend");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const series = useMemo<Series[]>(() => {
    let rank = 0;
    return pages.map((p, i) => {
      const key = seriesKey(p.landingPageId);
      return {
        id: `s${i}`,
        key,
        label: landingPageLabel(p.name),
        color: p.landingPageId === null ? "var(--ink-2)" : seriesColor(rank++),
      };
    });
  }, [pages]);
  const idByKey = useMemo(() => new Map(series.map((s) => [s.key, s.id])), [series]);
  const shown = useMemo(
    () => new Set(series.filter((s) => !hidden.has(s.key)).map((s) => s.key)),
    [series, hidden],
  );
  const drawn = useMemo(() => series.filter((s) => shown.has(s.key)), [series, shown]);

  const data = useMemo<PivotRow[]>(() => {
    if (daily.length === 0 || series.length === 0) return [];
    const byDate = new Map<string, PivotRow>();
    for (const b of dayBucketsInRange(from, to)) {
      const row: PivotRow = { date: b.key };
      for (const s of series) row[s.id] = 0;
      byDate.set(b.key, row);
    }
    for (const d of daily) {
      const row = byDate.get(d.date);
      const id = idByKey.get(seriesKey(d.landingPageId));
      if (!row || !id) continue;
      row[id] = (row[id] as number) + d[metric];
    }
    return [...byDate.values()];
  }, [daily, series, idByKey, from, to, metric]);

  const yValues = useMemo(() => {
    const out: number[] = [];
    for (const row of data) for (const s of drawn) out.push(row[s.id] as number);
    return out;
  }, [data, drawn]);
  const fit = useChartFit(yValues);
  const m = METRICS[metric];

  return (
    <ChartShell
      ariaLabel="Landing pages over time — expanded"
      legend={
        series.length > 0 ? (
          <SeriesLegend
            items={series.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
            shown={shown}
            onToggle={(key) =>
              setHidden((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            onShowAll={() => setHidden(new Set())}
          />
        ) : undefined
      }
    >
      {({ inFull, toggleExpand }) => (
        <div className={inFull ? "flex h-full flex-col" : undefined}>
          <ChartHeader
            title="Over time"
            picker={
              <MetricPicker
                options={METRIC_ORDER.map((key) => ({ value: key, label: METRICS[key].label }))}
                value={metric}
                onChange={setMetric}
              />
            }
            controls={<ExpandButton inFull={inFull} onClick={toggleExpand} />}
          />
          {data.length === 0 ? (
            <EmptyState
              className={(inFull ? "min-h-0 flex-1" : "h-64") + " flex flex-col items-center justify-center py-0"}
              title="No performance in this window."
              kind="filtered"
              buttons={false}
            />
          ) : (
            <div className={(inFull ? "min-h-0 flex-1" : "h-64") + " relative"}>
              <ChartFitToggle fit={fit} />
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => monthDay(d)}
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                    tickMargin={6}
                  />
                  <YAxis
                    tickFormatter={(v: number) => m.axis(v)}
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                    width={56}
                    domain={fit.clip ? [0, fit.cap] : undefined}
                    allowDataOverflow={fit.clip}
                  />
                  <Tooltip content={<PagesTooltip series={drawn} fmt={m.cell} />} />
                  {drawn.map((s) => (
                    <Line
                      key={s.id}
                      type="monotone"
                      dataKey={s.id}
                      stroke={s.color}
                      strokeWidth={1.8}
                      dot={false}
                      activeDot={{ r: 4 }}
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

interface TipEntry {
  dataKey: string;
  value: number;
  payload: PivotRow;
}

function PagesTooltip({
  active,
  payload,
  series,
  fmt,
}: {
  active?: boolean;
  payload?: TipEntry[];
  series: Series[];
  fmt: (v: number | null) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const date = payload[0]?.payload.date ?? "";
  // Biggest first, so the eye lands on the page that mattered that day.
  const entries = series
    .map((s) => ({ s, value: payload.find((p) => p.dataKey === s.id)?.value ?? 0 }))
    .sort((a, b) => b.value - a.value);
  return (
    <ChartTooltip>
      <div className="mb-1.5 font-medium text-ink">{monthDay(date)}</div>
      <div className="space-y-1">
        {entries.map(({ s, value }) => (
          <div key={s.id} className="flex items-center justify-between gap-4">
            <span className="inline-flex max-w-[12rem] items-center gap-1.5 text-ink-2">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="tabular-nums text-ink">{fmt(value)}</span>
          </div>
        ))}
      </div>
    </ChartTooltip>
  );
}
