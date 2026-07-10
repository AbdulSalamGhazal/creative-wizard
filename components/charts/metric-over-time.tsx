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
import { MetricPicker } from "@/components/charts/metric-picker";
import { SeriesLegend } from "@/components/charts/series-legend";
import { ChartHeader, ChartShell, ExpandButton, SmoothToggle, GroupToggle } from "@/components/charts/chart-shell";
import { smoothColumns } from "@/lib/chart-smooth";
import { fillDailyGaps, fillGroupSeries } from "@/lib/time-series";
import { int, intCompact, monthDay, roas, usd, usdCompact } from "@/lib/format";
import { useChartFit, ChartFitToggle } from "@/components/charts/chart-fit";
import type { MetricOverTimeRow } from "@/db/queries/performance";
import { ChartTooltip } from "@/components/charts/chart-tooltip";

export interface OverTimeKey {
  key: string;
  label: string;
  color: string;
}

interface Props {
  rows: MetricOverTimeRow[];
  keys: OverTimeKey[];
  dimension: "platform" | "campaign";
  /** Shown next to "by campaign" (e.g. the pinned platform's name). */
  dimensionLabel?: string;
  /**
   * Grouped-total edge bounds (account data horizon + filter-set first-ever,
   * clamped to the window): the "All" line's leading/trailing pause zeros.
   * Per-dimension lines get their own edge fill upstream (platform dimension);
   * these apply only to the grouped line.
   */
  fillFrom?: string;
  fillTo?: string;
}

type MetricKey = "spend" | "revenue" | "conversions" | "cpa" | "roas";

interface MetricDef {
  value: MetricKey;
  label: string;
  additive: boolean;
  pick: (r: MetricOverTimeRow) => number | null;
  /** Denominator for a ratio metric — lets Group recombine it correctly
   *  (sum(value·weight)/sum(weight) = sum(numerator)/sum(denominator)) rather
   *  than averaging ratios. Omitted for additive metrics. */
  weight?: (r: MetricOverTimeRow) => number | null;
  fmt: (v: number | null) => string;
}

const METRICS: MetricDef[] = [
  { value: "spend", label: "Spend", additive: true, pick: (r) => r.spend, fmt: usd },
  { value: "revenue", label: "Revenue", additive: true, pick: (r) => r.conversionValue, fmt: usd },
  { value: "conversions", label: "Conversions", additive: true, pick: (r) => r.conversions, fmt: int },
  { value: "cpa", label: "CPA", additive: false, pick: (r) => r.cpa, weight: (r) => r.conversions, fmt: usd },
  {
    value: "roas",
    label: "ROAS",
    additive: false,
    pick: (r) => r.roas,
    weight: (r) => r.spend,
    fmt: (v) => roas(v),
  },
];

/** Combine many rows into one value: sum additive metrics; recombine a ratio
 *  from its weighted components so the grouped figure stays correct. */
function aggregate(def: MetricDef, rs: MetricOverTimeRow[]): number | null {
  if (def.additive) {
    let sum = 0;
    let any = false;
    for (const r of rs) {
      const v = def.pick(r);
      if (typeof v === "number") {
        sum += v;
        any = true;
      }
    }
    return any ? sum : null;
  }
  let num = 0;
  let den = 0;
  for (const r of rs) {
    const v = def.pick(r);
    const w = def.weight ? def.weight(r) : null;
    if (typeof v === "number" && typeof w === "number") {
      num += v * w;
      den += w;
    }
  }
  return den > 0 ? num / den : null;
}

function axisFormat(metric: MetricKey, v: number): string {
  if (metric === "conversions") return intCompact(v);
  if (metric === "roas") return roas(v);
  return usdCompact(v);
}

interface PivotRow {
  date: string;
  [series: string]: number | string | null;
}

/**
 * Daily metric per dimension (platform, or campaign when a single platform is
 * filtered) as separate lines. A dropdown in the header swaps which metric is
 * plotted; the data for every metric is sent up-front so switching is instant.
 */
export function MetricOverTimeChart({
  rows,
  keys,
  dimension,
  dimensionLabel,
  fillFrom,
  fillTo,
}: Props) {
  const [metric, setMetric] = useState<MetricKey>("spend");
  const [smooth, setSmooth] = useState(false);
  const [group, setGroup] = useState(false);
  // Track which series are hidden (toggled off via the legend). A hidden-set
  // (not a shown-set) means series that appear later default to shown.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const def = METRICS.find((m) => m.value === metric) ?? METRICS[0]!;
  // Recharts resolves a STRING dataKey through lodash get(), which treats "." /
  // "[" / "]" as a nested path — so a campaign name like "2.0 Launch ➤ Broad"
  // would silently plot nothing (looked up as row["2"]["0 Launch ➤ Broad"]).
  // Map every series to a safe synthetic id (s0, s1, …) used for the pivot
  // property AND the <Line dataKey>; the real name lives only in the label.
  const safeKeys = useMemo(
    () => keys.map((k, i) => ({ ...k, id: `s${i}` })),
    [keys],
  );
  const idByKey = useMemo(
    () => new Map(safeKeys.map((k) => [k.key, k.id])),
    [safeKeys],
  );
  const shown = useMemo(
    () => new Set(keys.filter((k) => !hidden.has(k.key)).map((k) => k.key)),
    [keys, hidden],
  );
  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // The lines actually drawn: one combined line when grouped, else the shown
  // series. (When grouped, the legend still picks WHICH series feed the total.)
  const lineSpecs = useMemo<Array<{ id: string; color: string; label: string }>>(() => {
    if (group) {
      return [
        {
          id: "all",
          color: "var(--brand)",
          label: dimension === "campaign" ? "All campaigns" : "All platforms",
        },
      ];
    }
    return safeKeys
      .filter((k) => !hidden.has(k.key))
      .map((k) => ({ id: k.id, color: k.color, label: k.label }));
  }, [group, dimension, safeKeys, hidden]);

  const labelById = useMemo(
    () => new Map(lineSpecs.map((l) => [l.id, l.label])),
    [lineSpecs],
  );

  const data = useMemo<PivotRow[]>(() => {
    if (rows.length === 0) return [];
    if (group) {
      // One rotation-safe line over the union of the shown series' days,
      // trailing to the account data horizon (a paused account dips to 0) and
      // leading from the filter set's first-ever day. See fillGroupSeries.
      const shownRows = rows.filter((r) => shown.has(r.key));
      return fillGroupSeries(
        shownRows as unknown as Array<Record<string, unknown>>,
        {
          dateKey: "date",
          aggregate: (pts) =>
            aggregate(def, pts as unknown as MetricOverTimeRow[]),
          additive: def.additive,
          fillFrom,
          fillTo,
        },
      ) as PivotRow[];
    }
    // Ungrouped: one column per series. The per-series rows already carry their
    // own interior (+ platform-dimension edge) fill from the query; pivot them
    // straight. fillDailyGaps here only completes dates absent from EVERY series
    // (an account-wide pause) — those stay null so the lines break.
    const byDate = new Map<string, PivotRow>();
    for (const r of rows) {
      let e = byDate.get(r.date);
      if (!e) {
        e = { date: r.date };
        for (const k of safeKeys) e[k.id] = null;
        byDate.set(r.date, e);
      }
      const id = idByKey.get(r.key);
      if (id) e[id] = def.pick(r);
    }
    const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    return fillDailyGaps(sorted as Array<Record<string, unknown>>, {
      dateKey: "date",
      additiveKeys: [],
      ratioKeys: safeKeys.map((k) => k.id),
    }) as PivotRow[];
  }, [rows, group, shown, safeKeys, idByKey, def, fillFrom, fillTo]);

  const display = useMemo(
    () => (smooth ? smoothColumns(data, lineSpecs.map((l) => l.id)) : data),
    [smooth, data, lineSpecs],
  );

  // Robust Y-axis: cap a lone anomaly spike so the rest stays readable. Only
  // the drawn lines count, so hiding a spike rescales to fill the space.
  const yValues = useMemo(() => {
    const out: number[] = [];
    for (const row of display)
      for (const l of lineSpecs) {
        const v = row[l.id];
        if (typeof v === "number") out.push(v);
      }
    return out;
  }, [display, lineSpecs]);
  const fit = useChartFit(yValues);

  return (
    <ChartShell
      ariaLabel="Metric over time — expanded"
      legend={
        keys.length > 0 ? (
          <SeriesLegend
            items={keys.map((k) => ({ key: k.key, label: k.label, color: k.color }))}
            shown={shown}
            onToggle={toggle}
            onShowAll={() => setHidden(new Set())}
          />
        ) : undefined
      }
    >
      {({ inFull, toggleExpand }) => (
        <div className={inFull ? "flex flex-col h-full" : undefined}>
          <ChartHeader
            title="Performance over time"
            picker={
              <MetricPicker
                options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
                value={metric}
                onChange={setMetric}
              />
            }
            controls={
              <>
                {dimension === "campaign" && (
                  <span className="text-[11px] text-ink-3">
                    by campaign{dimensionLabel ? ` · ${dimensionLabel}` : ""}
                  </span>
                )}
                <GroupToggle on={group} onToggle={() => setGroup((v) => !v)} />
                <SmoothToggle on={smooth} onToggle={() => setSmooth((v) => !v)} />
                <ExpandButton inFull={inFull} onClick={toggleExpand} />
              </>
            }
          />

          {display.length === 0 ? (
            <div
              className={
                (inFull ? "flex-1 min-h-0" : "h-64") +
                " flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md"
              }
            >
              No data in the selected window.
            </div>
          ) : (
            <div className={(inFull ? "flex-1 min-h-0" : "h-64") + " relative"}>
              <ChartFitToggle fit={fit} />
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={display} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => monthDay(d)}
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                    tickMargin={6}
                  />
                  <YAxis
                    tickFormatter={(v: number) => axisFormat(metric, v)}
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                    width={56}
                    domain={fit.clip ? [0, fit.cap] : undefined}
                    allowDataOverflow={fit.clip}
                  />
                  <Tooltip
                    content={
                      <CustomTooltip
                        fmt={def.fmt}
                        showTotal={!group && def.additive && lineSpecs.length > 1}
                        labelByKey={labelById}
                      />
                    }
                  />
                  {lineSpecs.map((l) => (
                    <Line
                      key={l.id}
                      type="monotone"
                      dataKey={l.id}
                      stroke={l.color}
                      strokeWidth={group ? 2.2 : 1.8}
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

interface TooltipPayloadEntry {
  dataKey: string;
  value: number | null;
  color: string;
}

function CustomTooltip({
  active,
  payload,
  label,
  fmt,
  showTotal,
  labelByKey,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  fmt: (v: number | null) => string;
  showTotal: boolean;
  labelByKey: Map<string, string>;
}) {
  if (!active || !payload || payload.length === 0 || !label) return null;
  const total = payload.reduce((sum, p) => sum + (p.value ?? 0), 0);
  return (
    <ChartTooltip>
      <div className="text-ink-2 mb-1.5">{monthDay(label)}</div>
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 min-w-[170px]">
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: p.color }}
            />
            <span className="text-ink-2 truncate max-w-[110px]">
              {labelByKey.get(p.dataKey) ?? p.dataKey}
            </span>
            <span className="ml-auto text-ink num">{fmt(p.value)}</span>
          </div>
        ))}
        {showTotal && (
          <div className="flex items-center gap-2 pt-1 mt-1 border-t border-line">
            <span className="text-ink-3">Total</span>
            <span className="ml-auto text-ink num font-semibold">{fmt(total)}</span>
          </div>
        )}
      </div>
    </ChartTooltip>
  );
}
