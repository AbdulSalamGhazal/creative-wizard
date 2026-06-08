"use client";

import { Fragment, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { spearman } from "@/lib/correlation";
import type { CreativeMetricRow } from "@/db/queries/performance";

type MetricKey =
  | "spend"
  | "cpm"
  | "ctr"
  | "hookRate"
  | "holdRate"
  | "voc"
  | "cvr"
  | "cpa"
  | "roas";

/** Everything that can be swapped into the matrix. */
const CATALOG: Array<{ key: MetricKey; label: string }> = [
  { key: "spend", label: "Spend" },
  { key: "cpm", label: "CPM" },
  { key: "ctr", label: "CTR" },
  { key: "hookRate", label: "Hook" },
  { key: "holdRate", label: "Hold" },
  { key: "voc", label: "VOC" },
  { key: "cvr", label: "CvR" },
  { key: "cpa", label: "CPA" },
  { key: "roas", label: "ROAS" },
];
const LABEL = Object.fromEntries(CATALOG.map((m) => [m.key, m.label])) as Record<
  MetricKey,
  string
>;

/** Default six: cost + engagement + conversion + the two outcomes. */
const DEFAULT: MetricKey[] = ["spend", "cpm", "ctr", "cvr", "cpa", "roas"];

// Pairs that move together by construction (they share formula components), so a
// strong coefficient is arithmetic, not behaviour — shown muted. CPA =
// spend/conversions and ROAS = revenue/spend are inverse by build; CPA ∝
// CPC / CvR.
const MECHANICAL = new Set(["cpa|roas", "cpa|cvr"]);
const pairKey = (a: string, b: string) => [a, b].sort().join("|");

// Creatives with almost no delivery carry no signal — exclude them so a 12-
// impression fluke can't enter the ranking.
const MIN_IMPRESSIONS = 100;
const MIN_PAIRS = 6;

/** ".42" / "-.07" / "1" — compact, no leading zero. */
function fmtRho(r: number): string {
  if (r >= 0.995) return "1";
  if (r <= -0.995) return "-1";
  return (r < 0 ? "-" : "") + Math.abs(r).toFixed(2).replace(/^0/, "");
}

/**
 * Per-creative Spearman correlation matrix. Reads "which signals move with
 * which" across the filtered creatives — headline being which early funnel
 * signals (CTR, Hook, Hold, CPM) actually track the outcome (ROAS / CPA).
 * Green = positive, red = negative, intensity = strength; coefficient printed.
 *
 * Each column header is a picker: swap a metric there and the left (row) axis
 * mirrors it, since a correlation matrix is symmetric. Mechanically-linked pairs
 * are muted; cells with too few creatives show a dot. Respects all filters.
 */
export function CorrelationMatrix({ rows }: { rows: CreativeMetricRow[] }) {
  const [selected, setSelected] = useState<MetricKey[]>(DEFAULT);

  const usable = useMemo(
    () => rows.filter((r) => r.impressions >= MIN_IMPRESSIONS),
    [rows],
  );

  const matrix = useMemo(
    () =>
      selected.map((rowKey) =>
        selected.map((colKey) => {
          if (rowKey === colKey) return null;
          const pairs: Array<[number, number]> = [];
          for (const r of usable) {
            const a = r[rowKey];
            const b = r[colKey];
            if (a == null || b == null) continue;
            pairs.push([a, b]);
          }
          return spearman(pairs, MIN_PAIRS);
        }),
      ),
    [selected, usable],
  );

  // Change the metric in column slot `i`. If it already occupies another slot,
  // swap the two so the six stay distinct. The left axis reads `selected`, so it
  // mirrors automatically.
  const changeSlot = (i: number, key: MetricKey) =>
    setSelected((prev) => {
      const next = [...prev];
      const j = next.indexOf(key);
      if (j === i) return prev;
      if (j >= 0) next[j] = next[i]!;
      next[i] = key;
      return next;
    });

  const n = selected.length;

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader className="space-y-1">
        <CardTitle className="text-sm">Metric correlations</CardTitle>
        <p className="text-[11px] text-ink-3">
          Spearman ρ · {usable.length} creative{usable.length === 1 ? "" : "s"} ·
          pick a column to swap a metric
        </p>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center">
        {usable.length < MIN_PAIRS ? (
          <div className="h-40 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md text-center px-4">
            Not enough creatives with delivery in this window to correlate.
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className="grid gap-[2px] text-[10px]"
              style={{
                gridTemplateColumns: `minmax(30px,auto) repeat(${n}, minmax(0,1fr))`,
              }}
            >
              {/* Corner + column-header pickers */}
              <div />
              {selected.map((key, i) => (
                <Select
                  key={`h-${i}`}
                  value={key}
                  onValueChange={(v) => changeSlot(i, v as MetricKey)}
                >
                  <SelectTrigger className="h-6 w-full justify-center gap-0.5 border-0 bg-transparent px-0.5 text-[10px] font-semibold text-ink-2 shadow-none hover:text-ink focus:ring-0 focus:ring-offset-0 [&>svg]:size-3 [&>svg]:opacity-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATALOG.map((m) => (
                      <SelectItem key={m.key} value={m.key} className="text-sm">
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}

              {/* Rows (left labels mirror the column pickers) */}
              {selected.map((rowKey, i) => (
                <Fragment key={`r-${rowKey}`}>
                  <div className="flex items-center justify-end pr-1.5 font-semibold text-ink-3">
                    {LABEL[rowKey]}
                  </div>
                  {selected.map((colKey, j) => {
                    if (i === j) {
                      return (
                        <div
                          key={colKey}
                          className="aspect-square rounded-[3px] bg-surface-2/50 flex items-center justify-center text-ink-3 num"
                        >
                          1
                        </div>
                      );
                    }
                    const res = matrix[i]![j];
                    if (!res) {
                      return (
                        <div
                          key={colKey}
                          className="aspect-square rounded-[3px] border border-line/60 flex items-center justify-center text-ink-3"
                          title={`${LABEL[rowKey]} vs ${LABEL[colKey]}: too few creatives`}
                        >
                          ·
                        </div>
                      );
                    }
                    const mech = MECHANICAL.has(pairKey(rowKey, colKey));
                    const mag = Math.min(1, Math.abs(res.rho));
                    const pct = mech
                      ? 14
                      : Math.round((0.14 + mag * 0.62) * 100);
                    const base = res.rho >= 0 ? "var(--pos)" : "var(--neg)";
                    return (
                      <div
                        key={colKey}
                        className={`aspect-square rounded-[3px] flex items-center justify-center num ${
                          mech ? "italic text-ink-3" : "font-semibold text-ink"
                        }`}
                        style={{
                          backgroundColor: `color-mix(in srgb, ${base} ${pct}%, transparent)`,
                        }}
                        title={`${LABEL[rowKey]} vs ${LABEL[colKey]}: ρ = ${res.rho.toFixed(
                          2,
                        )} · n = ${res.n}${mech ? " · mechanically related" : ""}`}
                      >
                        {fmtRho(res.rho)}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-between gap-2 text-[10px] text-ink-3">
              <span className="inline-flex items-center gap-1">
                <span
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: "var(--neg)" }}
                />
                −1
                <span className="mx-1">to</span>
                <span
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: "var(--pos)" }}
                />
                +1
              </span>
              <span
                className="italic"
                title="These pairs share a formula component, so they correlate by arithmetic, not creative behaviour — e.g. CPA and ROAS are inverse by definition."
              >
                muted = mechanically linked
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
