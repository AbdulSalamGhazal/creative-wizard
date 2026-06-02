import { ArrowDown } from "lucide-react";
import { int, pct } from "@/lib/format";
import type { FunnelTotals } from "@/db/queries/funnel";

/**
 * The volume funnel: Impressions → Clicks → LP views → Conversions. Each bar's
 * width is its share of the top stage (impressions), and the rate that takes
 * you from one stage to the next (CTR, VOC, CvR) is labelled between them — so
 * you can see exactly where a campaign set is leaking.
 */
const STAGES: Array<{
  volKey: "impressions" | "clicks" | "landingPageViews" | "conversions";
  label: string;
  color: string;
  rateKey?: "ctr" | "voc" | "cvr";
  rateLabel?: string;
}> = [
  { volKey: "impressions", label: "Impressions", color: "#60A5FA" },
  { volKey: "clicks", label: "Clicks", color: "#34D399", rateKey: "ctr", rateLabel: "CTR" },
  { volKey: "landingPageViews", label: "LP views", color: "#FBBF24", rateKey: "voc", rateLabel: "VOC" },
  { volKey: "conversions", label: "Conversions", color: "#A78BFA", rateKey: "cvr", rateLabel: "CvR" },
];

export function FunnelStages({ totals }: { totals: FunnelTotals }) {
  const top = Math.max(totals.impressions, 1);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h3 className="text-sm text-ink-2 mb-3">Funnel</h3>
      <div className="space-y-1">
        {STAGES.map((s) => {
          const vol = totals[s.volKey];
          const widthPct = Math.max((vol / top) * 100, 1.5);
          const rate = s.rateKey ? totals[s.rateKey] : null;
          return (
            <div key={s.volKey}>
              {s.rateLabel && (
                <div className="flex items-center gap-1 pl-[6.5rem] py-1 text-[10px] text-ink-3">
                  <ArrowDown className="w-3 h-3" />
                  <span className="uppercase tracking-[0.12em]">{s.rateLabel}</span>
                  <span className="text-ink-2 tabular-nums">{pct(rate)}</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="w-24 shrink-0 text-xs text-ink-2 text-right">
                  {s.label}
                </div>
                <div className="flex-1 h-8 rounded bg-surface-2 overflow-hidden relative">
                  <div
                    className="h-full rounded transition-all"
                    style={{ width: `${widthPct}%`, background: s.color, opacity: 0.85 }}
                  />
                  <span className="absolute inset-y-0 left-2.5 flex items-center text-[11px] text-ink tabular-nums">
                    {int(vol)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
