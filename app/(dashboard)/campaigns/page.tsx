import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import {
  comparisonWindow,
  COMPARE_LABEL,
  portfolioAllocation,
  portfolioCampaigns,
  portfolioKpis,
  portfolioLaunches,
  portfolioMovers,
  portfolioTrend,
  type CompareMode,
  type PortfolioFilters,
} from "@/db/queries/portfolio";
import { getRatingRules } from "@/db/queries/rating";
import { portfolioFiltersSchema } from "@/validators/portfolio";
import { getPreferredRange } from "@/db/queries/user-prefs";
import { ksaCalendarEvents, KSA_EVENT_COLOR } from "@/lib/ksa-calendar";
import { PortfolioFilterBar } from "@/components/portfolio/portfolio-filter-bar";
import { PortfolioScorecard } from "@/components/portfolio/portfolio-scorecard";
import { PortfolioTrend, type TrendAnnotation } from "@/components/portfolio/portfolio-trend";
import { PortfolioAllocation } from "@/components/portfolio/portfolio-allocation";
import { PortfolioEfficiencyScatter } from "@/components/portfolio/portfolio-efficiency-scatter";
import { PortfolioPareto } from "@/components/portfolio/portfolio-pareto";
import { PortfolioMovers } from "@/components/portfolio/portfolio-movers";
import { PortfolioTable } from "@/components/portfolio/portfolio-table";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const rawFrom = pickFirst(params.from);
  const rawTo = pickFirst(params.to);
  const parsed = portfolioFiltersSchema.parse({
    from: rawFrom,
    to: rawTo,
    platforms: pickFirst(params.platforms),
    q: pickFirst(params.q),
    compare: pickFirst(params.compare),
    includeExcluded: pickFirst(params.includeExcluded),
  });

  // The page is always range-bounded (comparisons + rolling averages work). An
  // explicit URL range wins (validated); otherwise the user's saved default,
  // else the validator's last-7 fallback.
  const range =
    rawFrom && rawTo
      ? { from: parsed.from, to: parsed.to }
      : ((await getPreferredRange()) ?? { from: parsed.from, to: parsed.to });
  const from = range.from;
  const to = range.to;
  const compare = parsed.compare as CompareMode;

  const filters: PortfolioFilters = {
    from,
    to,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    q: parsed.q,
    includeExcluded: parsed.includeExcluded,
  };

  const [kpis, trend, allocation, campaigns, launches, rating] =
    await Promise.all([
      portfolioKpis(filters, compare),
      portfolioTrend(filters),
      portfolioAllocation(filters),
      portfolioCampaigns(filters),
      portfolioLaunches(filters),
      getRatingRules(),
    ]);

  // Target CPA is derived from the good-ROAS threshold × current AOV.
  const goodRoas = rating.goodRoas;
  const targetRoas = goodRoas > 0 ? goodRoas : null;
  const targetCpa =
    kpis.current.aov !== null && goodRoas > 0 ? kpis.current.aov / goodRoas : null;

  const movers = await portfolioMovers(filters, compare, targetCpa);

  // Data-driven timeline annotations: creative launches + KSA calendar.
  const annotations: TrendAnnotation[] = [
    ...launches.map((l) => ({
      date: l.date,
      label: `${l.count} launch${l.count === 1 ? "" : "es"}`,
      color: "var(--brand)",
    })),
    ...ksaCalendarEvents(from, to).map((e) => ({
      date: e.date,
      label: e.label,
      color: KSA_EVENT_COLOR[e.type],
      minor: e.type === "payday",
    })),
  ];

  const cmp = comparisonWindow(from, to, compare);
  const compareCaption = `${COMPARE_LABEL[compare]} (${cmp.from} → ${cmp.to})`;

  return (
    <div className="space-y-6">
      {/* Header + filters */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
            Campaigns
          </div>
          <h1 className="font-display text-4xl tracking-tight">All campaigns</h1>
          <p className="text-ink-2 text-sm mt-1 max-w-2xl">
            Portfolio command center — where the budget goes, what&apos;s working,
            what&apos;s wasting, and what changed. Drill into Funnel or a creative
            from here.
          </p>
        </div>
        <Badge variant="outline" className="text-ink-3 shrink-0">
          {from} → {to}
        </Badge>
      </div>

      <Suspense fallback={null}>
        <PortfolioFilterBar defaultFrom={from} defaultTo={to} />
      </Suspense>

      {/* 1. Scorecard */}
      <PortfolioScorecard kpis={kpis} caption={compareCaption} />

      {/* 2. Trend */}
      <PortfolioTrend data={trend} annotations={annotations} targetCpa={targetCpa} />

      {/* 3 + 4. Allocation + efficiency scatter */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PortfolioAllocation rows={allocation} />
        <PortfolioEfficiencyScatter
          rows={campaigns}
          targetCpa={targetCpa}
          targetRoas={targetRoas}
        />
      </div>

      {/* 5 + 6. Concentration + triage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PortfolioPareto rows={campaigns} />
        <PortfolioMovers items={movers} />
      </div>

      {/* 7. Full table */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">All campaigns</h2>
          <span className="text-[11px] text-ink-3">
            {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} · sortable · scroll for more
          </span>
        </div>
        <PortfolioTable rows={campaigns} />
      </section>
    </div>
  );
}
