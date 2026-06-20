"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { int, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FunnelTotals } from "@/db/queries/funnel";

/**
 * Horizontal volume funnel: Impressions → Clicks → LP views → Add to cart →
 * Add payment → Conversions, left to right. Each stage is a vertical bar whose
 * height is its log-scaled volume (so every stage stays visible); the step
 * conversion rate is labelled in the connector between stages. The final stage
 * shows BOTH paths to purchase — CvR (AP) (the AP→purchase step) and CvR (LP)
 * (the overall LP→purchase). A toggle switches the connector labels between the
 * per-step rate and the cumulative reach (% of impressions).
 */

type View = "step" | "reach";

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
  stepKey?: StepKey;
  stepLabel?: string;
}> = [
  { volKey: "impressions", label: "Impressions", color: "#60A5FA" },
  { volKey: "clicks", label: "Clicks", color: "#34D399", stepKey: "ctr", stepLabel: "CTR" },
  { volKey: "landingPageViews", label: "LP views", color: "#FBBF24", stepKey: "voc", stepLabel: "VOC" },
  { volKey: "addToCart", label: "Add to cart", color: "#22D3EE", stepKey: "atcRate", stepLabel: "ATC" },
  { volKey: "addPayment", label: "Add payment", color: "#F472B6", stepKey: "apRate", stepLabel: "AP" },
  { volKey: "conversions", label: "Conversions", color: "#A78BFA", stepKey: "purchaseRate", stepLabel: "CvR (AP)" },
];

export function FunnelStages({ totals }: { totals: FunnelTotals }) {
  const [view, setView] = useState<View>("step");
  const top = Math.max(totals.impressions, 10);
  const logTop = Math.log10(top);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h3 className="text-sm text-ink-2">Funnel</h3>
          <p className="text-[10px] text-ink-3 max-w-lg">
            Bar height is log-scaled so every stage stays visible. The last step
            has two paths to purchase: <span className="text-ink-2">CvR (AP)</span>{" "}
            (purchases / add-payment) and <span className="text-ink-2">CvR (LP)</span>{" "}
            (purchases / LP views).
          </p>
        </div>
        <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-[11px] shrink-0">
          {(
            [
              ["step", "Step rate"],
              ["reach", "Reach %"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              className={cn(
                "px-2.5 h-7 rounded transition-colors",
                view === k ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-stretch gap-0.5 overflow-x-auto pb-1">
        {STAGES.map((s, i) => {
          const vol = totals[s.volKey];
          const barH =
            vol > 0
              ? Math.min(100, Math.max((Math.log10(Math.max(vol, 1)) / logTop) * 100, 8))
              : 4;
          const stepVal = s.stepKey ? totals[s.stepKey] : null;
          const reachVal = totals.impressions > 0 ? vol / totals.impressions : null;
          return (
            <Fragment key={s.volKey}>
              {i > 0 && (
                <div className="shrink-0 w-12 flex flex-col items-center justify-center text-center gap-0.5">
                  <ChevronRight className="w-4 h-4 text-ink-3" />
                  <span className="text-[9px] uppercase tracking-wide text-ink-3 leading-none">
                    {view === "step" ? s.stepLabel : "reach"}
                  </span>
                  <span className="text-[11px] text-ink-2 tabular-nums leading-none">
                    {pct(view === "step" ? stepVal : reachVal)}
                  </span>
                </div>
              )}
              <div className="flex-1 min-w-[78px] flex flex-col justify-end items-center">
                <div className="text-[11px] text-ink tabular-nums mb-1">{int(vol)}</div>
                <div className="w-full h-28 flex items-end rounded bg-surface-2/40 overflow-hidden">
                  <div
                    className="w-full rounded-t transition-all"
                    style={{ height: `${barH}%`, background: s.color, opacity: 0.85 }}
                  />
                </div>
                <div className="text-[10px] text-ink-2 mt-1.5 text-center leading-tight">
                  {s.label}
                </div>
                {s.volKey === "conversions" && (
                  <div className="mt-1 inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-ink-3">
                    CvR (LP)
                    <span className="text-ink-2 tabular-nums normal-case tracking-normal">
                      {pct(totals.cvr)}
                    </span>
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
