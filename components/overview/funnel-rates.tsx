import { ArrowDownRight, ArrowUpRight, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeDelta, type Delta } from "@/lib/period";
import { pct, usd } from "@/lib/format";
import type { Kpis, KpisWithDelta } from "@/db/queries/performance";

/**
 * The four funnel efficiency rates — CPM, CTR, VOC, CvR — each as a large
 * number with a period-over-period delta. CPM is lower-is-better (inverted);
 * the rest are higher-is-better.
 */
export function FunnelRates({ k, kd }: { k: Kpis; kd: KpisWithDelta | null }) {
  const rates: Array<{
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
      <CardContent className="flex-1 flex flex-col justify-between gap-2">
        {rates.map((r) => (
          <div key={r.label} className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3">
              {r.label}
            </div>
            <div className="flex items-end justify-between gap-3">
              <span className="font-display text-[2.6rem] leading-none num text-ink">
                {r.value}
              </span>
              {r.delta ? <BigDelta delta={r.delta} inverted={r.inverted} /> : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function BigDelta({ delta, inverted }: { delta: Delta; inverted?: boolean }) {
  if (delta.mode === "absent") {
    return <span className="text-sm text-ink-3">—</span>;
  }
  if (delta.mode === "new") {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-pos">
        <Sparkles className="w-4 h-4" />
        New
      </span>
    );
  }
  if (delta.mode === "removed") {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-neg">
        <ArrowDownRight className="w-4 h-4" />
        Gone
      </span>
    );
  }
  const p = delta.pct ?? 0;
  const up = p >= 0;
  const good = inverted ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-sm font-semibold num ${
        good ? "text-pos" : "text-neg"
      }`}
    >
      <Icon className="w-4 h-4" />
      {up ? "+" : ""}
      {(p * 100).toFixed(1)}%
    </span>
  );
}
