import {
  Banknote,
  Coins,
  MousePointerClick,
  Percent,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { MetricCard, type BreakdownBar } from "@/components/overview/metric-card";
import { seriesColor } from "@/lib/palette";
import { int, pct, ratio, usd } from "@/lib/format";
import type {
  CampaignAnalytics,
  CampaignCreativeRow,
} from "@/db/queries/campaign";

/**
 * The campaign's headline KPIs, each broken down by creative — same card shape
 * as the dashboard (a big figure + per-dimension bars), but the dimension is
 * the creative rather than the platform. Volume metrics (spend / conversions /
 * revenue) fill by share of the campaign total; rate metrics (ROAS / CPA / CTR
 * / CvR) fill relative to the strongest creative. Top 8 creatives per card.
 */

const TOP_N = 8;

export function CampaignCreativeKpis({
  analytics,
  creatives,
}: {
  analytics: CampaignAnalytics;
  creatives: CampaignCreativeRow[];
}) {
  const t = analytics.totals;
  const d = analytics.deltas;

  // Color by rank in the (spend-sorted) creative list — same mapping the chart
  // uses — so a creative is the same color everywhere and no two collide.
  const colorOf = new Map(creatives.map((c, i) => [c.creativeId, seriesColor(i)]));

  const shareBars = (
    pick: (c: CampaignCreativeRow) => number,
    fmt: (n: number) => string,
    total: number,
  ): BreakdownBar[] =>
    [...creatives]
      .sort((a, b) => pick(b) - pick(a))
      .filter((c) => pick(c) > 0)
      .slice(0, TOP_N)
      .map((c) => ({
        key: c.creativeId,
        label: c.name,
        color: colorOf.get(c.creativeId) ?? "#888",
        fraction: total > 0 ? pick(c) / total : 0,
        display: fmt(pick(c)),
      }));

  const rateBars = (
    pick: (c: CampaignCreativeRow) => number | null,
    fmt: (n: number) => string,
  ): BreakdownBar[] => {
    const vals = creatives
      .map((c) => ({ c, v: pick(c) }))
      .filter((x): x is { c: CampaignCreativeRow; v: number } => x.v !== null);
    const max = Math.max(...vals.map((x) => x.v), 0);
    return vals
      .sort((a, b) => b.v - a.v)
      .slice(0, TOP_N)
      .map(({ c, v }) => ({
        key: c.creativeId,
        label: c.name,
        color: colorOf.get(c.creativeId) ?? "#888",
        fraction: max > 0 ? v / max : 0,
        display: fmt(v),
      }));
  };

  const totalRevenue = creatives.reduce((s, c) => s + c.conversionValue, 0);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <MetricCard
        label="Spend"
        value={usd(t.spend)}
        icon={Wallet}
        delta={d?.spend}
        bars={shareBars((c) => c.spend, (n) => usd(n), t.spend)}
      />
      <MetricCard
        label="Conversions"
        value={int(t.conversions)}
        icon={ShoppingCart}
        delta={d?.conversions}
        bars={shareBars((c) => c.conversions, (n) => int(n), t.conversions)}
      />
      <MetricCard
        label="Revenue"
        value={usd(t.conversionValue)}
        icon={Banknote}
        delta={d?.conversionValue}
        bars={shareBars((c) => c.conversionValue, (n) => usd(n), totalRevenue)}
      />
      <MetricCard
        label="ROAS"
        value={ratio(t.roas)}
        icon={TrendingUp}
        delta={d?.roas}
        bars={rateBars((c) => c.roas, (n) => ratio(n))}
      />
      <MetricCard
        label="CPA"
        value={usd(t.cpa)}
        icon={Coins}
        delta={d?.cpa}
        deltaInverted
        bars={rateBars((c) => c.cpa, (n) => usd(n))}
      />
      <MetricCard
        label="CTR"
        value={pct(t.ctr)}
        icon={MousePointerClick}
        delta={d?.ctr}
        bars={rateBars((c) => c.ctr, (n) => pct(n))}
      />
      <MetricCard
        label="CvR"
        value={pct(t.cvr)}
        icon={Percent}
        delta={d?.cvr}
        bars={rateBars((c) => c.cvr, (n) => pct(n))}
      />
    </div>
  );
}
