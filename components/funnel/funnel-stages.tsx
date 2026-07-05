"use client";

import { useState } from "react";
import { int, pct, intCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FunnelTotals } from "@/db/queries/funnel";

/**
 * A clean, classic funnel: the six stages stacked top to bottom, each a
 * proportional bar with its count and the % that passes to the next step.
 *
 * Compare toggle ("vs previous period") draws a faded shadow bar at the
 * comparison's value behind each stage, plus a dashed marker at exactly where
 * it landed and a per-row delta — so the gap between the solid bar and the
 * shadow IS the difference.
 */

type VolKey =
  | "impressions"
  | "clicks"
  | "landingPageViews"
  | "addToCart"
  | "addPayment"
  | "conversions";
type StepKey = "ctr" | "voc" | "atcRate" | "apRate" | "purchaseRate";

const STAGES: Array<{
  volKey: VolKey;
  label: string;
  color: string;
  /** Rate of the step LEAVING this stage (→ the next one). Last stage has none. */
  stepKey?: StepKey;
}> = [
  { volKey: "impressions", label: "Impressions", color: "#60A5FA", stepKey: "ctr" },
  { volKey: "clicks", label: "Clicks", color: "#34D399", stepKey: "voc" },
  { volKey: "landingPageViews", label: "LP views", color: "#FBBF24", stepKey: "atcRate" },
  { volKey: "addToCart", label: "Add to cart", color: "#22D3EE", stepKey: "apRate" },
  { volKey: "addPayment", label: "Add payment", color: "#F472B6", stepKey: "purchaseRate" },
  { volKey: "conversions", label: "Conversions", color: "#A78BFA" },
];

export function FunnelStages({
  totals,
  compareTotals,
}: {
  totals: FunnelTotals;
  compareTotals: FunnelTotals;
}) {
  const [compare, setCompare] = useState(false);

  const counts = STAGES.map((s) => totals[s.volKey]);
  const cmpCounts = STAGES.map((s) => compareTotals[s.volKey]);

  // Share one width scale across current + comparison so the bars are
  // directly comparable (and nothing overflows past 100%).
  const pool = compare ? [...counts, ...cmpCounts] : counts;
  const maxC = Math.max(...pool, 1);
  const positives = pool.filter((c) => c > 0);
  const minC = positives.length ? Math.max(Math.min(...positives), 1) : 1;
  const span = Math.log10(maxC) - Math.log10(minC) || 1;
  const widthOf = (c: number) =>
    c <= 0 ? 10 : 15 + (85 * (Math.log10(c) - Math.log10(minC))) / span;

  const overall = totals.impressions > 0 ? totals.conversions / totals.impressions : null;

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="text-sm text-ink-2">Funnel</h3>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-ink-3 num">
            {intCompact(totals.impressions)} → {int(totals.conversions)} ·{" "}
            {pct(overall)} overall
          </span>
          <button
            type="button"
            onClick={() => setCompare((v) => !v)}
            aria-pressed={compare}
            className={cn(
              "h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors shrink-0",
              compare
                ? "border-brand/50 bg-[var(--brand-soft)] text-ink"
                : "border-line text-ink-2 hover:text-ink hover:bg-surface-2",
            )}
          >
            vs previous period
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {STAGES.map((s, i) => {
          const count = counts[i] ?? 0;
          const cmp = cmpCounts[i] ?? 0;
          const stepRate = s.stepKey ? totals[s.stepKey] : null;
          const cmpStepRate = s.stepKey ? compareTotals[s.stepKey] : null;
          const curW = widthOf(count);
          const cmpW = widthOf(cmp);
          return (
            <div key={s.volKey}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-xs text-ink-2">{s.label}</span>
                <span className="flex items-baseline gap-2">
                  {compare && <CountDelta cur={count} cmp={cmp} />}
                  <span className="text-xs text-ink num tabular-nums">
                    {int(count)}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative flex-1 h-7 rounded bg-surface-2/50 overflow-hidden">
                  {compare && (
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{ width: `${cmpW}%`, background: s.color, opacity: 0.2 }}
                    />
                  )}
                  <div
                    className="absolute inset-y-0 left-0 rounded-r"
                    style={{ width: `${curW}%`, background: s.color, opacity: 0.9 }}
                  />
                  {compare && (
                    <div
                      className="absolute inset-y-0 border-l border-dashed"
                      style={{ left: `${cmpW}%`, borderColor: "rgba(255,255,255,0.55)" }}
                    />
                  )}
                </div>
                <span className="w-24 shrink-0 text-right text-[11px] text-ink-3 num tabular-nums">
                  {stepRate !== null ? (
                    <>
                      ↓ {pct(stepRate)}
                      {compare && <RateDelta cur={stepRate} cmp={cmpStepRate} />}
                    </>
                  ) : (
                    ""
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {compare && (
        <p className="mt-3 text-[10px] text-ink-3">
          Shaded bar + dashed line = previous period. Deltas compare the current
          window to the one before it.
        </p>
      )}
    </div>
  );
}

function CountDelta({ cur, cmp }: { cur: number; cmp: number }) {
  if (cmp <= 0)
    return <span className="text-[10px] text-ink-3 num">new</span>;
  const d = (cur - cmp) / cmp;
  const up = d >= 0;
  return (
    <span className={cn("text-[10px] num tabular-nums", up ? "text-pos" : "text-neg")}>
      {up ? "+" : ""}
      {(d * 100).toFixed(0)}%
    </span>
  );
}

function RateDelta({ cur, cmp }: { cur: number | null; cmp: number | null }) {
  if (cur === null || cmp === null || cmp === 0) return null;
  const d = (cur - cmp) / cmp;
  const up = d >= 0;
  return (
    <span className={cn("ml-1 text-[10px]", up ? "text-pos" : "text-neg")}>
      {up ? "▲" : "▼"}
      {Math.abs(d * 100).toFixed(0)}%
    </span>
  );
}
