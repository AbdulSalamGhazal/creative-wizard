import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { int, pct } from "@/lib/format";
import type { Kpis } from "@/db/queries/performance";

/**
 * Blended conversion funnel: Impressions → Clicks → Landing views →
 * Conversions, with the step-rate (CTR / VOC / CvR) between each. Bar widths
 * are each stage as a share of impressions, so the drop-off is visible.
 */
export function FunnelCard({ k }: { k: Kpis }) {
  const top = k.impressions ?? 0;
  const stages = [
    { label: "Impressions", value: k.impressions ?? 0, rate: null as number | null, rateLabel: "" },
    { label: "Clicks", value: k.clicks ?? 0, rate: k.ctr, rateLabel: "CTR" },
    { label: "Landing views", value: k.landingPageViews ?? 0, rate: k.voc, rateLabel: "VOC" },
    { label: "Conversions", value: k.conversions ?? 0, rate: k.cvr, rateLabel: "CvR" },
  ];

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm">Conversion funnel</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center gap-1.5">
        {top <= 0 ? (
          <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
            No impressions in this window.
          </div>
        ) : (
          stages.map((s, i) => {
            const width = top > 0 ? Math.max(1.5, (s.value / top) * 100) : 0;
            return (
              <div key={s.label}>
                {i > 0 && s.rate !== null && (
                  <div className="text-[10px] text-ink-3 mb-1">
                    ↓ {pct(s.rate)} {s.rateLabel}
                  </div>
                )}
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-ink-2">{s.label}</span>
                  <span className="num text-ink">{int(s.value)}</span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${width}%`, background: "var(--brand)" }}
                  />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
