import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Sparkline } from "@/components/charts/sparkline";
import { pct, usd } from "@/lib/format";
import type { Delta } from "@/lib/period";
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
  { key: "cpm", label: "CPM", color: "#FBBF24", inverted: true },
  { key: "ctr", label: "CTR", color: "#60A5FA" },
  { key: "voc", label: "VOC", color: "#34D399" },
  { key: "atcRate", label: "ATC", color: "#22D3EE" },
  { key: "apRate", label: "AP", color: "#F472B6" },
  { key: "purchaseRate", label: "CvR (AP)", color: "#FB923C" },
  { key: "cvr", label: "CvR (LP)", color: "#A78BFA" },
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
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {RATES.map((r) => {
        const value = r.key === "cpm" ? usd(c.cpm) : pct(c[r.key]);
        const delta = overview.deltas[r.key];
        return (
          <div
            key={r.key}
            className="rounded-xl bg-surface-2/60 px-4 py-3.5 flex flex-col gap-2.5"
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-2 truncate">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: r.color }}
                />
                {r.label}
              </span>
              <Trend delta={delta} inverted={r.inverted} />
            </div>
            <span className="font-display text-[2rem] leading-[0.95] num text-ink">
              {value}
            </span>
            <Sparkline
              values={series(r.key)}
              color={r.color}
              width={200}
              height={34}
              baseline="data"
              responsive
            />
          </div>
        );
      })}
    </div>
  );
}

function Trend({ delta, inverted }: { delta: Delta; inverted?: boolean }) {
  if (delta.mode !== "pct") {
    return <span className="text-[11px] text-ink-3">—</span>;
  }
  const p = delta.pct ?? 0;
  const up = p >= 0;
  const good = inverted ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold num shrink-0 ${
        good ? "text-pos" : "text-neg"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {up ? "+" : ""}
      {(p * 100).toFixed(1)}%
    </span>
  );
}
