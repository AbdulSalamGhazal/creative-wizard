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
import { CompareChart, COMPARE_COLORS } from "@/components/charts/compare-chart";
import {
  compareFiltersSchema,
  sideIsEmpty,
  type CompareSide,
} from "@/validators/compare";
import { int, pct, ratio, usd } from "@/lib/format";

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
          <div className="overflow-x-auto">
            <table className="w-full text-sm num">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3">
                  <th className="font-medium px-2 py-2">Side</th>
                  <th className="font-medium px-2 py-2">Selection</th>
                  <th className="font-medium px-2 py-2 text-right">Spend</th>
                  <th className="font-medium px-2 py-2 text-right">Impressions</th>
                  <th className="font-medium px-2 py-2 text-right">CTR</th>
                  <th className="font-medium px-2 py-2 text-right">CvR</th>
                  <th className="font-medium px-2 py-2 text-right">CPA</th>
                  <th className="font-medium px-2 py-2 text-right">ROAS</th>
                  <th className="font-medium px-2 py-2 text-right">Hook rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[
                  { label: "Side A", side: parsed.sideA, t: aTotals, i: 0 },
                  { label: "Side B", side: parsed.sideB, t: bTotals, i: 1 },
                ].map(({ label, side, t, i }) => (
                  <tr key={label} className="hover:bg-surface-2/60 transition-colors">
                    <td className="px-2 py-2.5">
                      <span className="inline-flex items-center gap-2 text-ink font-medium">
                        <span
                          className="w-2 h-2 rounded-sm shrink-0"
                          style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }}
                        />
                        {label}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-ink-3 text-xs">
                      {sideSummary(side)}
                    </td>
                    <td className="px-2 py-2.5 text-right text-ink">{usd(t.spend)}</td>
                    <td className="px-2 py-2.5 text-right text-ink-2">{int(t.impressions)}</td>
                    <td className="px-2 py-2.5 text-right text-ink-2">{pct(t.ctr)}</td>
                    <td className="px-2 py-2.5 text-right text-ink-2">{pct(t.cvr)}</td>
                    <td className="px-2 py-2.5 text-right text-ink-2">{usd(t.cpa)}</td>
                    <td className="px-2 py-2.5 text-right text-ink">{ratio(t.roas)}</td>
                    <td className="px-2 py-2.5 text-right text-ink-2">{pct(t.hookRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
