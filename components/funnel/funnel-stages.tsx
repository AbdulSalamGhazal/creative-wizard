"use client";

import { useState } from "react";
import { int, pct, intCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { computeDelta } from "@/lib/period";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import { InfoTip } from "@/components/ui/info-tip";
import { FUNNEL_METRIC_COLOR } from "@/lib/palette";
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

// Each stage is colored by the rate LEAVING it, from the shared
// FUNNEL_METRIC_COLOR map — so a stage bar reads the same hue as its rate tile
// on the /funnel page (theme-aware CSS vars, legible on the light themes). The
// terminal Conversions stage has no leaving rate, so it takes the CvR color.
const STAGES: Array<{
  volKey: VolKey;
  label: string;
  color: string;
  /** Rate of the step LEAVING this stage (→ the next one). Last stage has none. */
  stepKey?: StepKey;
}> = [
  { volKey: "impressions", label: "Impressions", color: FUNNEL_METRIC_COLOR.ctr, stepKey: "ctr" },
  { volKey: "clicks", label: "Clicks", color: FUNNEL_METRIC_COLOR.voc, stepKey: "voc" },
  { volKey: "landingPageViews", label: "LP views", color: FUNNEL_METRIC_COLOR.atcRate, stepKey: "atcRate" },
  { volKey: "addToCart", label: "Add to cart", color: FUNNEL_METRIC_COLOR.apRate, stepKey: "apRate" },
  { volKey: "addPayment", label: "Add payment", color: FUNNEL_METRIC_COLOR.purchaseRate, stepKey: "purchaseRate" },
  { volKey: "conversions", label: "Conversions", color: FUNNEL_METRIC_COLOR.cvr },
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
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-medium text-ink">Volume by stage</h3>
          {compare && (
            <InfoTip label="How the comparison is drawn">
              Shaded bar + dashed line = previous period. Deltas compare the current
              window to the one before it.
            </InfoTip>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-ink-3 tabular-nums">
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
                ? "border-brand/50 bg-brand-soft text-ink"
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
          const curW = widthOf(count);
          const cmpW = widthOf(cmp);
          return (
            <div key={s.volKey}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-xs text-ink-2">{s.label}</span>
                <span className="flex items-baseline gap-2">
                  {compare && <DeltaBadge delta={computeDelta(count, cmp)} />}
                  <span className="text-xs text-ink tabular-nums">
                    {int(count)}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative flex-1 h-7 rounded-sm bg-surface-2/50 overflow-hidden">
                  {compare && (
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{ width: `${cmpW}%`, background: s.color, opacity: 0.2 }}
                    />
                  )}
                  <div
                    className="absolute inset-y-0 left-0 rounded-r-sm"
                    style={{ width: `${curW}%`, background: s.color, opacity: 0.9 }}
                  />
                  {compare && (
                    <div
                      className="absolute inset-y-0 border-l border-dashed"
                      style={{
                        left: `${cmpW}%`,
                        borderColor: "color-mix(in srgb, var(--ink) 55%, transparent)",
                      }}
                    />
                  )}
                </div>
                <span className="w-24 shrink-0 text-right text-[11px] text-ink-3 tabular-nums">
                  {stepRate !== null ? <>↓ {pct(stepRate)}</> : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
