import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import { computeDelta, type Delta } from "@/lib/period";
import { pct, usd } from "@/lib/format";
import type { Kpis, KpisWithDelta } from "@/db/queries/performance";

/**
 * The four funnel efficiency rates — CPM, CTR, VOC, CvR — as soft stat tiles
 * with a period-over-period delta pill. CPM is lower-is-better (inverted); the
 * rest are higher-is-better.
 */
export function FunnelRates({ k, kd }: { k: Kpis; kd: KpisWithDelta | null }) {
  const rates: Array<{
    label: string;
    hint: string;
    value: string;
    delta?: Delta;
    inverted?: boolean;
  }> = [
    { label: "CPM", hint: "cost / 1k impr.", value: usd(k.cpm), delta: kd?.delta.cpm, inverted: true },
    { label: "CTR", hint: "clicks / impr.", value: pct(k.ctr), delta: kd?.delta.ctr },
    {
      label: "VOC",
      hint: "views / clicks",
      value: pct(k.voc),
      delta: kd ? computeDelta(kd.current.voc, kd.previous.voc) : undefined,
    },
    { label: "CvR", hint: "conv. / views", value: pct(k.cvr), delta: kd?.delta.cvr },
  ];

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm">Funnel rates</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 grid grid-cols-2 gap-2.5">
        {rates.map((r) => (
          <div
            key={r.label}
            className="rounded-xl bg-surface-2/60 px-4 py-3 flex flex-col justify-center gap-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold tracking-wide text-ink-2">
                {r.label}
              </span>
              {r.delta ? <DeltaBadge delta={r.delta} inverted={r.inverted} /> : null}
            </div>
            <div className="font-display text-[2.2rem] leading-none num text-ink">
              {r.value}
            </div>
            <div className="text-[10px] text-ink-3">{r.hint}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
