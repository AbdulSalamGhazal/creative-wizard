import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import { computeDelta, type Delta } from "@/lib/period";
import { pct, usd } from "@/lib/format";
import type { Kpis, KpisWithDelta } from "@/db/queries/performance";

/**
 * The four funnel efficiency rates — CPM, CTR, VOC, CvR — each as a number with
 * a period-over-period delta. CPM is lower-is-better (inverted badge); the rest
 * are higher-is-better.
 */
export function FunnelRates({ k, kd }: { k: Kpis; kd: KpisWithDelta | null }) {
  const tiles: Array<{
    label: string;
    value: string;
    delta?: Delta;
    inverted?: boolean;
  }> = [
    { label: "CPM", value: usd(k.cpm), delta: kd?.delta.cpm, inverted: true },
    { label: "CTR", value: pct(k.ctr), delta: kd?.delta.ctr },
    {
      label: "VOC",
      value: pct(k.voc),
      delta: kd ? computeDelta(kd.current.voc, kd.previous.voc) : undefined,
    },
    { label: "CvR", value: pct(k.cvr), delta: kd?.delta.cvr },
  ];

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm">Funnel rates</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 grid grid-cols-2 gap-3 content-center">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-lg border border-line bg-surface-2/40 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
                {t.label}
              </span>
              {t.delta ? (
                <DeltaBadge delta={t.delta} inverted={t.inverted} />
              ) : null}
            </div>
            <div className="font-display text-[1.9rem] leading-none num text-ink mt-2">
              {t.value}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
