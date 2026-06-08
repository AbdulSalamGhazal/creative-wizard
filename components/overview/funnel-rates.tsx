import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkline } from "@/components/charts/sparkline";
import { computeDelta, type Delta } from "@/lib/period";
import { pct, usd } from "@/lib/format";
import type { DailyRatesRow, Kpis, KpisWithDelta } from "@/db/queries/performance";

type RateKey = "cpm" | "ctr" | "voc" | "cvr";

const COLOR: Record<RateKey, string> = {
  cpm: "#4f8efb", // blue
  ctr: "#a855f7", // violet
  voc: "#f59e0b", // amber
  cvr: "#34d399", // emerald
};

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
  const series = (key: RateKey): number[] =>
    daily.map((d) => d[key]).filter((v): v is number => v !== null);

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
      <CardContent className="flex-1 grid grid-cols-2 gap-2.5">
        {rates.map((r) => {
          const color = COLOR[r.key];
          return (
            <div
              key={r.key}
              className="rounded-xl bg-surface-2/60 px-4 py-3 flex flex-col justify-between gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: color }}
                  />
                  {r.label}
                </span>
                {r.delta ? <Trend delta={r.delta} inverted={r.inverted} /> : null}
              </div>
              <div className="flex items-end justify-between gap-2">
                <span className="font-display text-[2.1rem] leading-none num text-ink">
                  {r.value}
                </span>
                <Sparkline values={series(r.key)} color={color} width={66} height={26} />
              </div>
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
