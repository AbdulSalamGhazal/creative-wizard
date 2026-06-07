import { Banknote, DollarSign, Receipt, Target, TrendingUp } from "lucide-react";
import {
  kpis,
  metricBreakdown,
  type BreakdownDimension,
  type KpiFilters,
  type MetricBreakdownRow,
} from "@/db/queries/performance";
import { MetricCard, type BreakdownBar } from "@/components/overview/metric-card";
import { PLATFORM_COLOR, PLATFORM_LABEL, swatchColor } from "@/lib/palette";
import { int, intCompact, ratio, usd, usdCompact } from "@/lib/format";

const CAMPAIGN_LIMIT = 8;

type Pick = (r: MetricBreakdownRow) => number | null;

/**
 * The five headline Dashboard metrics — Spend, Conversions, Revenue, CPA,
 * ROAS — each with a per-dimension breakdown below it. Composition metrics
 * (Spend/Conversions/Revenue) render share bars; ratio metrics (CPA/ROAS)
 * render value-comparison bars (scaled to the max). The dimension is platform
 * normally, or campaign when the view is pinned to a single platform.
 */
export async function DashboardMetrics({
  filters,
  dimension,
}: {
  filters: KpiFilters;
  dimension: BreakdownDimension;
}) {
  const [k, full] = await Promise.all([
    kpis(filters),
    metricBreakdown(filters, dimension),
  ]);

  const isCampaign = dimension === "campaign";
  const shown = isCampaign ? full.slice(0, CAMPAIGN_LIMIT) : full;
  const moreCount = full.length - shown.length;

  const labelFor = (key: string) =>
    isCampaign ? key : PLATFORM_LABEL[key as keyof typeof PLATFORM_LABEL] ?? key;
  const colorFor = (key: string) =>
    isCampaign
      ? swatchColor(key)
      : PLATFORM_COLOR[key as keyof typeof PLATFORM_COLOR] ?? "var(--ink-3)";

  // Composition: bar = this group's share of the total for that metric.
  const shareBars = (pick: Pick, fmt: (v: number | null) => string): BreakdownBar[] => {
    const denom = full.reduce((s, r) => s + (pick(r) ?? 0), 0);
    return shown.map((r) => ({
      key: r.key,
      label: labelFor(r.key),
      color: colorFor(r.key),
      fraction: denom > 0 ? (pick(r) ?? 0) / denom : 0,
      display: fmt(pick(r)),
    }));
  };

  // Ratio: bar = this group's value relative to the largest in the set.
  const valueBars = (pick: Pick, fmt: (v: number) => string): BreakdownBar[] => {
    const vals = shown
      .map((r) => pick(r))
      .filter((v): v is number => v !== null);
    const max = vals.length ? Math.max(...vals) : 0;
    return shown.map((r) => {
      const v = pick(r);
      return {
        key: r.key,
        label: labelFor(r.key),
        color: colorFor(r.key),
        fraction: v !== null && max > 0 ? v / max : 0,
        display: v !== null ? fmt(v) : "—",
      };
    });
  };

  const shareCaption = isCampaign ? "Share by campaign" : "Share by platform";
  const valueCaption = isCampaign ? "By campaign" : "By platform";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <MetricCard
          label="Spend"
          value={usd(k.spend)}
          icon={DollarSign}
          caption={shareCaption}
          bars={shareBars((r) => r.spend, usdCompact)}
        />
        <MetricCard
          label="Conversions"
          value={int(k.conversions)}
          icon={Target}
          caption={shareCaption}
          bars={shareBars((r) => r.conversions, intCompact)}
        />
        <MetricCard
          label="Revenue"
          value={usd(k.conversionValue)}
          icon={Banknote}
          caption={shareCaption}
          bars={shareBars((r) => r.conversionValue, usdCompact)}
        />
        <MetricCard
          label="CPA"
          value={usd(k.cpa)}
          icon={Receipt}
          caption={valueCaption}
          bars={valueBars((r) => r.cpa, usd)}
        />
        <MetricCard
          label="ROAS"
          value={k.roas !== null ? `${ratio(k.roas)}×` : "—"}
          icon={TrendingUp}
          caption={valueCaption}
          bars={valueBars((r) => r.roas, (v) => `${ratio(v)}×`)}
        />
      </div>
      {isCampaign && moreCount > 0 && (
        <p className="text-[11px] text-ink-3">
          Showing the top {CAMPAIGN_LIMIT} campaigns by spend · {moreCount} more
          not shown.
        </p>
      )}
    </div>
  );
}
