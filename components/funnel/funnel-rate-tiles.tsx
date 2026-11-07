import { Sparkline } from "@/components/charts/sparkline";
import { MetricCard } from "@/components/overview/metric-card";
import { pct, usd } from "@/lib/format";
import { FUNNEL_METRIC_COLOR } from "@/lib/palette";
import type { FunnelOverview, FunnelDailyPoint } from "@/db/queries/funnel";

type RateKey =
  | "cpm"
  | "ctr"
  | "voc"
  | "atcRate"
  | "apRate"
  | "purchaseRate"
  | "cvr";

/** Colors match the trend-chart lines + funnel viz so the page reads as one set. */
const RATES: Array<{
  key: RateKey;
  label: string;
  color: string;
  inverted?: boolean;
}> = [
  { key: "cpm", label: "CPM", color: FUNNEL_METRIC_COLOR.cpm, inverted: true },
  { key: "ctr", label: "CTR", color: FUNNEL_METRIC_COLOR.ctr },
  { key: "voc", label: "VOC", color: FUNNEL_METRIC_COLOR.voc },
  { key: "atcRate", label: "ATC", color: FUNNEL_METRIC_COLOR.atcRate },
  { key: "apRate", label: "AP", color: FUNNEL_METRIC_COLOR.apRate },
  { key: "purchaseRate", label: "CvR (AP)", color: FUNNEL_METRIC_COLOR.purchaseRate },
  { key: "cvr", label: "CvR (LP)", color: FUNNEL_METRIC_COLOR.cvr },
];

/**
 * The seven headline funnel rates as one row of colorful stat tiles — same
 * language as the dashboard's "Funnel rates" card: a colored marker + label, a
 * big value with a delta, and a sparkline of the rate's daily trend. CPM is
 * lower-is-better (inverted). CvR (AP) = conversions / add-payment;
 * CvR (LP) = conversions / LP views.
 */
export function FunnelRateTiles({
  overview,
  daily,
}: {
  overview: FunnelOverview;
  daily: FunnelDailyPoint[];
}) {
  const c = overview.current;

  // Low-traffic days produce garbage rates (1 impression → 100% CTR) that blow
  // up the autoscale and flatten every normal day. Clamp the series to its
  // 10th–90th percentile, then lightly smooth it, exactly like the dashboard.
  const series = (key: RateKey): number[] => {
    let vals = daily.map((d) => d[key]).filter((v): v is number => v !== null);
    if (vals.length < 5) return vals;
    const sorted = [...vals].sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.round(p * (sorted.length - 1))]!;
    const lo = at(0.1);
    const hi = at(0.9);
    if (hi > lo) vals = vals.map((v) => Math.min(hi, Math.max(lo, v)));
    return vals.map((_, i) => {
      const s = Math.max(0, i - 1);
      const e = Math.min(vals.length, i + 2);
      const w = vals.slice(s, e);
      return w.reduce((a, b) => a + b, 0) / w.length;
    });
  };

  return (
    // 7-up only from xl: at lg each tile got ~97px and a 32px "$12.34" ran
    // into its neighbour (R-017). The tile is the house MetricCard (R-010), so
    // the value shrinks to fit and a narrow header stacks the delta.
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
      {RATES.map((r) => {
        const value = r.key === "cpm" ? usd(c.cpm) : pct(c[r.key]);
        return (
          <MetricCard
            key={r.key}
            label={r.label}
            value={value}
            dot={r.color}
            delta={overview.deltas[r.key]}
            deltaInverted={r.inverted}
            hideBreakdown
          >
            <div className="mt-2.5">
              <Sparkline
                values={series(r.key)}
                color={r.color}
                width={200}
                height={34}
                baseline="data"
                responsive
              />
            </div>
          </MetricCard>
        );
      })}
    </div>
  );
}

