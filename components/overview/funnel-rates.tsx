import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkline } from "@/components/charts/sparkline";
import { computeDelta, type Delta } from "@/lib/period";
import { pct, usd } from "@/lib/format";
import { FUNNEL_METRIC_COLOR } from "@/lib/palette";
import type { DailyRatesRow, Kpis, KpisWithDelta } from "@/db/queries/performance";

type RateKey = "cpm" | "ctr" | "voc" | "cvr";

// One shared source for funnel metric colors (lib/palette) — the old local map
// used the Facebook blue for CPM and disagreed with /funnel on CTR + VOC.
const COLOR = FUNNEL_METRIC_COLOR;

/**
 * The four funnel efficiency rates — CPM, CTR, VOC, CvR — as colorful stat
 * tiles: a colored marker + label, a big value with a delta, and a tiny
 * sparkline of the rate's daily trend. CPM is lower-is-better (inverted).
 */
export function FunnelRates({
  k,
  kd,
  daily,
}: {
  k: Kpis;
  kd: KpisWithDelta | null;
  daily: DailyRatesRow[];
}) {
  // Low-traffic days produce garbage rates (1 impression → 100% CTR) that blow
  // up the autoscale and flatten every normal day. Clamp the series to its
  // 10th–90th percentile (kills outliers even if several days are bad), then
  // lightly smooth it so the sparkline shows a clean trend.
  const series = (key: RateKey): number[] => {
    let vals = daily.map((d) => d[key]).filter((v): v is number => v !== null);
    if (vals.length < 5) return vals;
    const sorted = [...vals].sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.round(p * (sorted.length - 1))]!;
    const lo = at(0.1);
    const hi = at(0.9);
    if (hi > lo) vals = vals.map((v) => Math.min(hi, Math.max(lo, v)));
    // 3-point moving average.
    return vals.map((_, i) => {
      const s = Math.max(0, i - 1);
      const e = Math.min(vals.length, i + 2);
      const w = vals.slice(s, e);
      return w.reduce((a, b) => a + b, 0) / w.length;
    });
  };

  const rates: Array<{
    key: RateKey;
    label: string;
    value: string;
    delta?: Delta;
    inverted?: boolean;
  }> = [
    { key: "cpm", label: "CPM", value: usd(k.cpm), delta: kd?.delta.cpm, inverted: true },
    { key: "ctr", label: "CTR", value: pct(k.ctr), delta: kd?.delta.ctr },
    {
      key: "voc",
      label: "VOC",
      value: pct(k.voc),
      delta: kd ? computeDelta(kd.current.voc, kd.previous.voc) : undefined,
    },
    { key: "cvr", label: "CvR", value: pct(k.cvr), delta: kd?.delta.cvr },
  ];

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm">Funnel rates</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 grid grid-cols-2 gap-3">
        {rates.map((r) => {
          const color = COLOR[r.key];
          return (
            <div
              key={r.key}
              className="rounded-xl bg-surface-2/60 px-4 py-4 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: color }}
                  />
                  {r.label}
                </span>
                {r.delta ? <Trend delta={r.delta} inverted={r.inverted} /> : null}
              </div>
              <span className="font-display text-[3rem] leading-[0.95] num text-ink">
                {r.value}
              </span>
              <Sparkline
                values={series(r.key)}
                color={color}
                width={260}
                height={46}
                baseline="data"
                responsive
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function Trend({ delta, inverted }: { delta: Delta; inverted?: boolean }) {
  if (delta.mode !== "pct") {
    return <span className="text-sm text-ink-3">—</span>;
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
