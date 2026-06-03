import { KpiTile } from "@/components/kpi/kpi-tile";
import { int, pct, ratio, usd } from "@/lib/format";
import type { PortfolioKpis } from "@/db/queries/portfolio";

/**
 * Headline KPI strip. Orders/revenue/CPA/ROAS/AOV are the platform-reported
 * source of truth (summed across platforms). Each tile carries a delta vs the
 * selected comparison window; CPA/CPM are inverted (lower is better).
 */
export function PortfolioScorecard({
  kpis,
  caption,
}: {
  kpis: PortfolioKpis;
  caption: string;
}) {
  const c = kpis.current;
  const d = kpis.deltas;
  const tiles: Array<{
    label: string;
    value: string;
    delta: PortfolioKpis["deltas"][keyof PortfolioKpis["deltas"]];
    inverted?: boolean;
  }> = [
    { label: "Spend", value: usd(c.spend), delta: d.spend },
    { label: "Orders", value: int(c.orders), delta: d.orders },
    { label: "Revenue", value: usd(c.revenue), delta: d.revenue },
    { label: "CPA", value: c.cpa === null ? "—" : usd(c.cpa), delta: d.cpa, inverted: true },
    { label: "ROAS", value: c.roas === null ? "—" : `${ratio(c.roas)}×`, delta: d.roas },
    { label: "AOV", value: c.aov === null ? "—" : usd(c.aov), delta: d.aov },
    { label: "CTR", value: pct(c.ctr), delta: d.ctr },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
      {tiles.map((t) => (
        <KpiTile
          key={t.label}
          label={t.label}
          value={t.value}
          delta={t.delta}
          inverted={t.inverted}
          caption={caption}
        />
      ))}
    </div>
  );
}
