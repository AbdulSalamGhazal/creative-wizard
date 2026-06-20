import { int, pct } from "@/lib/format";
import type { FunnelTotals } from "@/db/queries/funnel";

/**
 * A clean, classic funnel: the six stages stacked top to bottom, each a
 * proportional bar with its count and the % that passes to the next step. The
 * bar widths use a log scale (normalised so the smallest stage stays visible)
 * so it reads as a funnel without the tail collapsing to nothing.
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

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function FunnelStages({ totals }: { totals: FunnelTotals }) {
  const counts = STAGES.map((s) => totals[s.volKey]);
  const maxC = Math.max(...counts, 1);
  const positives = counts.filter((c) => c > 0);
  const minC = positives.length ? Math.max(Math.min(...positives), 1) : 1;
  const span = Math.log10(maxC) - Math.log10(minC) || 1;
  // Log width, normalised so the smallest stage is ~15% wide (still visible).
  const widthOf = (c: number) =>
    c <= 0 ? 10 : 15 + (85 * (Math.log10(c) - Math.log10(minC))) / span;

  const overall = totals.impressions > 0 ? totals.conversions / totals.impressions : null;

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="text-sm text-ink-2">Funnel</h3>
        <span className="text-[11px] text-ink-3 num">
          {compact.format(totals.impressions)} → {int(totals.conversions)} ·{" "}
          {pct(overall)} overall
        </span>
      </div>

      <div className="space-y-3">
        {STAGES.map((s, i) => {
          const count = counts[i] ?? 0;
          const stepRate = s.stepKey ? totals[s.stepKey] : null;
          return (
            <div key={s.volKey}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[12px] text-ink-2">{s.label}</span>
                <span className="text-[12px] text-ink num tabular-nums">
                  {int(count)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-6 rounded bg-surface-2/50 overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${widthOf(count)}%`,
                      background: s.color,
                      opacity: 0.85,
                    }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-[11px] text-ink-3 num tabular-nums">
                  {stepRate !== null ? `↓ ${pct(stepRate)}` : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
