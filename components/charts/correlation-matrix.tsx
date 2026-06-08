import { Fragment } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { spearman } from "@/lib/correlation";
import type { CreativeMetricRow } from "@/db/queries/performance";

/** Curated, mostly-independent metric set (funnel signals + outcomes). */
const METRICS: Array<{ key: keyof CreativeMetricRow; label: string }> = [
  { key: "spend", label: "Spend" },
  { key: "cpm", label: "CPM" },
  { key: "ctr", label: "CTR" },
  { key: "hookRate", label: "Hook" },
  { key: "holdRate", label: "Hold" },
  { key: "cvr", label: "CvR" },
  { key: "cpa", label: "CPA" },
  { key: "roas", label: "ROAS" },
];

// Pairs that move together by construction (they share components), so a strong
// coefficient is algebra, not behaviour. Shown muted so they don't read as
// findings. CPA = spend/conversions and ROAS = revenue/spend are inverse by
// build; CPA ∝ CPC / CvR.
const MECHANICAL = new Set(["cpa|roas", "cpa|cvr"]);
const pairKey = (a: string, b: string) => [a, b].sort().join("|");

// Creatives with almost no delivery carry no signal — exclude them so a 12-
// impression fluke can't enter the ranking. (Spearman already tolerates the
// rest.)
const MIN_IMPRESSIONS = 100;
const MIN_PAIRS = 6;

/** ".42" / "-.07" / "1" — compact, no leading zero. */
function fmtRho(r: number): string {
  if (r >= 0.995) return "1";
  if (r <= -0.995) return "-1";
  const s = Math.abs(r).toFixed(2).replace(/^0/, "");
  return (r < 0 ? "-" : "") + s;
}

/**
 * Per-creative Spearman correlation matrix. Reads "which signals move with
 * which" across the filtered creatives — the headline being which early funnel
 * signals (CTR, Hook, Hold, CPM) actually track the outcome (ROAS / CPA).
 * Green = positive, red = negative, intensity = strength. Mechanically-linked
 * pairs are muted; cells with too few creatives show a dot. Respects all
 * dashboard filters. A server component — no interactivity needed.
 */
export function CorrelationMatrix({ rows }: { rows: CreativeMetricRow[] }) {
  const usable = rows.filter((r) => r.impressions >= MIN_IMPRESSIONS);
  const n = METRICS.length;

  const matrix = METRICS.map((rowM) =>
    METRICS.map((colM) => {
      if (rowM.key === colM.key) return null;
      const pairs: Array<[number, number]> = [];
      for (const r of usable) {
        const a = r[rowM.key];
        const b = r[colM.key];
        if (a == null || b == null) continue;
        pairs.push([a, b]);
      }
      return spearman(pairs, MIN_PAIRS);
    }),
  );

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader className="space-y-1">
        <CardTitle className="text-sm">Metric correlations</CardTitle>
        <p className="text-[11px] text-ink-3">
          Spearman ρ · {usable.length} creative{usable.length === 1 ? "" : "s"}
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
              {/* Column headers */}
              <div />
              {METRICS.map((m) => (
                <div
                  key={m.key}
                  className="flex items-end justify-center pb-1 font-medium text-ink-3"
                >
                  {m.label}
                </div>
              ))}

              {/* Rows */}
              {METRICS.map((rowM, i) => (
                <Fragment key={rowM.key}>
                  <div className="flex items-center justify-end pr-1.5 font-medium text-ink-3">
                    {rowM.label}
                  </div>
                  {METRICS.map((colM, j) => {
                    if (i === j) {
                      return (
                        <div
                          key={colM.key}
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
                          key={colM.key}
                          className="aspect-square rounded-[3px] border border-line/60 flex items-center justify-center text-ink-3"
                          title={`${rowM.label} vs ${colM.label}: too few creatives`}
                        >
                          ·
                        </div>
                      );
                    }
                    const mech = MECHANICAL.has(pairKey(rowM.key, colM.key));
                    const mag = Math.min(1, Math.abs(res.rho));
                    const pct = mech ? 14 : Math.round((0.14 + mag * 0.62) * 100);
                    const base = res.rho >= 0 ? "var(--pos)" : "var(--neg)";
                    return (
                      <div
                        key={colM.key}
                        className={`aspect-square rounded-[3px] flex items-center justify-center num ${
                          mech ? "italic text-ink-3" : "font-semibold text-ink"
                        }`}
                        style={{
                          backgroundColor: `color-mix(in srgb, ${base} ${pct}%, transparent)`,
                        }}
                        title={`${rowM.label} vs ${colM.label}: ρ = ${res.rho.toFixed(
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
              <span className="italic">muted = mechanically linked</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
