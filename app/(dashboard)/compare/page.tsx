import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  kpis,
  compareDimensions,
  compareSideSeries,
  type CompareMetric,
  type KpiFilters,
} from "@/db/queries/performance";
import { CompareControls } from "@/components/compare/compare-controls";
import {
  AddMetricBlock,
  MetricBlockHeader,
} from "@/components/compare/metric-blocks";
import { CompareChart } from "@/components/charts/compare-chart";
import { CompareTotalsTable } from "@/components/compare/compare-totals-table";
import {
  compareFiltersSchema,
  sideIsEmpty,
  type CompareSide,
} from "@/validators/compare";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Map a Compare side's selections onto the shared KpiFilters shape. */
function sideFilter(
  side: CompareSide,
  range: { from?: string; to?: string },
): KpiFilters {
  return {
    platforms: side.platforms.length ? side.platforms : undefined,
    campaignNames: side.campaigns.length ? side.campaigns : undefined,
    creativeIds: side.creatives.length ? side.creatives : undefined,
    ...range,
  };
}

function sideSummary(side: CompareSide): string {
  if (sideIsEmpty(side)) return "All data";
  const parts: string[] = [];
  if (side.platforms.length) parts.push(`${side.platforms.length} platform(s)`);
  if (side.campaigns.length) parts.push(`${side.campaigns.length} campaign(s)`);
  if (side.creatives.length) parts.push(`${side.creatives.length} creative(s)`);
  return parts.join(" · ");
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const parsed = compareFiltersSchema.parse({
    aPlatforms: pickFirst(params.aPlatforms),
    aCampaigns: pickFirst(params.aCampaigns),
    aCreatives: pickFirst(params.aCreatives),
    bPlatforms: pickFirst(params.bPlatforms),
    bCampaigns: pickFirst(params.bCampaigns),
    bCreatives: pickFirst(params.bCreatives),
    metrics: pickFirst(params.metrics),
    from: pickFirst(params.from),
    to: pickFirst(params.to),
  });

  const dimensions = await compareDimensions();
  const range =
    parsed.from && parsed.to ? { from: parsed.from, to: parsed.to } : {};
  const fa = sideFilter(parsed.sideA, range);
  const fb = sideFilter(parsed.sideB, range);

  const [aTotals, bTotals] = await Promise.all([kpis(fa), kpis(fb)]);

  // Per metric block, A's and B's daily series, tagged so the chart draws two
  // lines ("A" / "B").
  const seriesByMetric = await Promise.all(
    parsed.metrics.map(async (m: CompareMetric) => {
      const [a, b] = await Promise.all([
        compareSideSeries({ ...fa, metric: m }),
        compareSideSeries({ ...fb, metric: m }),
      ]);
      return [
        ...a.map((p) => ({ creativeId: "A", date: p.date, value: p.value })),
        ...b.map((p) => ({ creativeId: "B", date: p.date, value: p.value })),
      ];
    }),
  );

  const sides = [
    { id: "A", name: "Side A" },
    { id: "B", name: "Side B" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
          Compare
        </div>
        <h1 className="font-display text-4xl tracking-tight">A vs B comparison</h1>
        <p className="text-ink-2 text-sm mt-1">
          Define two sides by Platform → Campaign → Creative (each level
          optional = “all”), then stack a chart per metric. Blended figures are
          true weighted averages.
        </p>
      </div>

      <CompareControls
        dimensions={dimensions}
        sideA={parsed.sideA}
        sideB={parsed.sideB}
        from={parsed.from ?? null}
        to={parsed.to ?? null}
      />

      {/* One chart block per metric */}
      {parsed.metrics.map((metric, i) => (
        <Card key={metric} className="bg-surface border-line">
          <CardHeader>
            <MetricBlockHeader metric={metric} metrics={parsed.metrics} />
          </CardHeader>
          <CardContent>
            <CompareChart
              rows={seriesByMetric[i] ?? []}
              creatives={sides}
              metric={metric}
            />
          </CardContent>
        </Card>
      ))}

      <AddMetricBlock metrics={parsed.metrics} />

      {/* A vs B totals */}
      <Card className="bg-surface border-line">
        <CardHeader>
          <h2 className="text-sm font-medium text-ink">
            {parsed.from && parsed.to ? "Totals in window" : "All-time totals"}
          </h2>
        </CardHeader>
        <CardContent>
          <CompareTotalsTable
            sides={[
              {
                label: "Side A",
                selection: sideSummary(parsed.sideA),
                totals: aTotals,
              },
              {
                label: "Side B",
                selection: sideSummary(parsed.sideB),
                totals: bTotals,
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
