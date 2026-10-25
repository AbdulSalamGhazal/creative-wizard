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
import { int, intCompact, monthDay, pct, roas, usd, usdCompact } from "@/lib/format";
import { landingPageLabel } from "@/lib/landing-code";
import { seriesColor } from "@/lib/palette";
import type {
  LandingPageDailyRow,
  LandingPageRollupRow,
} from "@/db/queries/landing-page-performance";

type Metric = "spend" | "conversions" | "roas" | "ctr" | "cvr" | "cpa" | "cpc";

interface MetricDef {
  label: string;
  cell: (v: number | null) => string;
  axis: (v: number) => string;
  /**
   * A day's value from that day's component sums. Additive metrics are the
   * sum itself (an absent day is 0); a ratio is numerator / denominator —
   * the same weighted rule as the table — and NULL when the denominator is
   * 0, which the line draws as a gap, never a zero.
   */
  value: (d: LandingPageDailyRow) => number | null;
  additive: boolean;
}

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

const METRICS: Record<Metric, MetricDef> = {
  spend: { label: "Spend", cell: usd, axis: usdCompact, additive: true, value: (d) => d.spend },
  conversions: { label: "Conversions", cell: int, axis: intCompact, additive: true, value: (d) => d.conversions },
  roas: { label: "ROAS", cell: roas, axis: roas, additive: false, value: (d) => ratio(d.conversionValue, d.spend) },
  ctr: { label: "CTR", cell: pct, axis: pct, additive: false, value: (d) => ratio(d.clicks, d.impressions) },
  cvr: { label: "CvR", cell: pct, axis: pct, additive: false, value: (d) => ratio(d.conversions, d.landingPageViews) },
  cpa: { label: "CPA", cell: usd, axis: usdCompact, additive: false, value: (d) => ratio(d.spend, d.conversions) },
  cpc: { label: "CPC", cell: usd, axis: usdCompact, additive: false, value: (d) => ratio(d.spend, d.clicks) },
};
const METRIC_ORDER: Metric[] = ["spend", "conversions", "roas", "ctr", "cvr", "cpa", "cpc"];

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
  [id: string]: number | string | null;
}

const seriesKey = (landingPageId: string | null) => landingPageId ?? "product";

/**
 * One metric per day, one line per landing page over the resolved range.
 * Every day in the range is a point: for Spend and Conversions a day a page
 * had no record is a zero, because an absent day of an additive metric IS
 * zero; for a ratio (ROAS, CTR, CvR, CPA, CPC) such a day is a gap, and so is
 * a day whose denominator is 0. The product page draws in the neutral ink so
 * the registered pages carry the colour.
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

  const m = METRICS[metric];

  const data = useMemo<PivotRow[]>(() => {
    if (daily.length === 0 || series.length === 0) return [];
    const byDate = new Map<string, PivotRow>();
    for (const b of dayBucketsInRange(from, to)) {
      const row: PivotRow = { date: b.key };
      for (const s of series) row[s.id] = m.additive ? 0 : null;
      byDate.set(b.key, row);
    }
    // The query groups by (day, page), so each cell is set once.
    for (const d of daily) {
      const row = byDate.get(d.date);
      const id = idByKey.get(seriesKey(d.landingPageId));
      if (!row || !id) continue;
      row[id] = m.value(d);
    }
    return [...byDate.values()];
  }, [daily, series, idByKey, from, to, m]);

  const yValues = useMemo(() => {
    const out: number[] = [];
    for (const row of data)
      for (const s of drawn) {
        const v = row[s.id];
        if (typeof v === "number") out.push(v);
      }
    return out;
  }, [data, drawn]);
  const fit = useChartFit(yValues);

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

interface TipEntry {
  dataKey: string;
  value: number | null;
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
  // Biggest first, so the eye lands on the page that mattered that day; a
  // page with nothing that day (a ratio's gap) reads as a dash, last.
  const entries = series
    .map((s) => ({ s, value: payload.find((p) => p.dataKey === s.id)?.value ?? null }))
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
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
