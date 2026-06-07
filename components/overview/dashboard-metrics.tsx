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
import { int, intCompact, ratio, usd0, usd1, usdCompact } from "@/lib/format";

const CAMPAIGN_LIMIT = 8;

type Pick = (r: MetricBreakdownRow) => number | null;

/**
 * The headline Dashboard metrics — Spend, Conversions, Revenue, CPA, ROAS, and
 * Running ads — each with a per-dimension breakdown below it. Composition
 * metrics (Spend/Conversions/Revenue) render share bars; ratio/count metrics
 * (CPA/ROAS/Running) render value-comparison bars (scaled to the max). The
 * dimension is platform normally, or campaign when pinned to a single platform.
 *
 * "Running ads" is the count of creatives whose live status is Active (from the
 * dynamic status model) — a current-state figure, so it reflects the platform
 * filter but not the date window.
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

  // Composition: bar = this group's share of the total for that metric. Groups
  // with no value for the metric are dropped (no zero-rows).
  const shareBars = (pick: Pick, fmt: (v: number | null) => string): BreakdownBar[] => {
    const denom = full.reduce((s, r) => s + (pick(r) ?? 0), 0);
    return shown
      .filter((r) => (pick(r) ?? 0) > 0)
      .map((r) => ({
        key: r.key,
        label: labelFor(r.key),
        color: colorFor(r.key),
        fraction: denom > 0 ? (pick(r) ?? 0) / denom : 0,
        display: fmt(pick(r)),
      }));
  };

  // Ratio: bar = this group's value relative to the largest in the set. Groups
  // with no value are dropped.
  const valueBars = (pick: Pick, fmt: (v: number) => string): BreakdownBar[] => {
    const rows = shown.filter((r) => (pick(r) ?? 0) > 0);
    const vals = rows.map((r) => pick(r)).filter((v): v is number => v !== null);
    const max = vals.length ? Math.max(...vals) : 0;
    return rows.map((r) => {
      const v = pick(r)!;
      return {
        key: r.key,
        label: labelFor(r.key),
        color: colorFor(r.key),
        fraction: max > 0 ? v / max : 0,
        display: fmt(v),
      };
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard
          label="Spend"
          value={usd0(k.spend)}
          icon={DollarSign}
          bars={shareBars((r) => r.spend, usdCompact)}
        />
        <MetricCard
          label="Conversions"
          value={int(k.conversions)}
          icon={Target}
          bars={shareBars((r) => r.conversions, intCompact)}
        />
        <MetricCard
          label="Revenue"
          value={usd0(k.conversionValue)}
          icon={Banknote}
          bars={shareBars((r) => r.conversionValue, usdCompact)}
        />
        <MetricCard
          label="CPA"
          value={usd1(k.cpa)}
          icon={Receipt}
          bars={valueBars((r) => r.cpa, usd1)}
        />
        <MetricCard
          label="ROAS"
          value={k.roas !== null ? `${ratio(k.roas)}×` : "—"}
          icon={TrendingUp}
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
