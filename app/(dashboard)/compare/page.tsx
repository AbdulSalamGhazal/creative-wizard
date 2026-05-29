import { asc, eq } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { db } from "@/lib/db";
import { creatives, products } from "@/db/schema";
import { compareSeries, compareTotals } from "@/db/queries/performance";
import { CompareControls } from "@/components/compare/compare-controls";
import {
  AddMetricBlock,
  MetricBlockHeader,
} from "@/components/compare/metric-blocks";
import { CompareChart, COMPARE_COLORS } from "@/components/charts/compare-chart";
import { compareFiltersSchema } from "@/validators/compare";
import { int, pct, ratio, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const parsed = compareFiltersSchema.parse({
    creativeIds: pickFirst(params.creativeIds),
    metrics: pickFirst(params.metrics),
    from: pickFirst(params.from),
    to: pickFirst(params.to),
  });

  const allCreatives = await db
    .select({
      id: creatives.id,
      name: creatives.name,
      productName: products.name,
    })
    .from(creatives)
    .innerJoin(products, eq(products.id, creatives.productId))
    .orderBy(asc(creatives.name));

  const validIds = parsed.creativeIds.filter((id) =>
    allCreatives.some((c) => c.id === id),
  );
  const orderedCreatives = validIds
    .map((id) => allCreatives.find((c) => c.id === id))
    .filter((c): c is (typeof allCreatives)[number] => !!c);

  const dateFilter =
    parsed.from && parsed.to ? { from: parsed.from, to: parsed.to } : {};

  // One daily series per metric block + the totals, all in parallel.
  const [seriesByMetric, totals] = await Promise.all([
    Promise.all(
      parsed.metrics.map((m) =>
        validIds.length >= 1
          ? compareSeries({ creativeIds: validIds, metric: m, ...dateFilter })
          : Promise.resolve([]),
      ),
    ),
    validIds.length >= 1
      ? compareTotals({ creativeIds: validIds, ...dateFilter })
      : Promise.resolve([]),
  ]);

  const totalsById = new Map(totals.map((t) => [t.creativeId, t]));
  const hasPicks = orderedCreatives.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
          Compare
        </div>
        <h1 className="font-display text-4xl tracking-tight">
          Side-by-side comparison
        </h1>
        <p className="text-ink-2 text-sm mt-1">
          Pick up to five creatives, then stack a comparison block per metric.
          Blended figures are true weighted averages, not averages of ratios.
        </p>
      </div>

      <CompareControls
        allCreatives={allCreatives}
        selected={validIds}
        from={parsed.from ?? null}
        to={parsed.to ?? null}
      />

      {!hasPicks ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
          <p className="text-ink-2 text-sm">
            Pick at least one creative to start comparing.
          </p>
          <p className="text-ink-3 text-xs mt-1">
            Use “Add creative” above — search by name or product.
          </p>
        </div>
      ) : (
        <>
          {/* One block per metric */}
          {parsed.metrics.map((metric, i) => (
            <Card key={metric} className="bg-surface border-line">
              <CardHeader>
                <MetricBlockHeader metric={metric} metrics={parsed.metrics} />
              </CardHeader>
              <CardContent>
                <CompareChart
                  rows={seriesByMetric[i] ?? []}
                  creatives={orderedCreatives}
                  metric={metric}
                />
              </CardContent>
            </Card>
          ))}

          <AddMetricBlock metrics={parsed.metrics} />

          {/* Totals across the picked creatives */}
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
                      <th className="font-medium px-2 py-2">Creative</th>
                      <th className="font-medium px-2 py-2">Product</th>
                      <th className="font-medium px-2 py-2 text-right">Spend</th>
                      <th className="font-medium px-2 py-2 text-right">Impressions</th>
                      <th className="font-medium px-2 py-2 text-right">CTR</th>
                      <th className="font-medium px-2 py-2 text-right">CPA</th>
                      <th className="font-medium px-2 py-2 text-right">ROAS</th>
                      <th className="font-medium px-2 py-2 text-right">Hook rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {orderedCreatives.map((c, i) => {
                      const t = totalsById.get(c.id);
                      return (
                        <tr
                          key={c.id}
                          className="hover:bg-surface-2/60 transition-colors"
                        >
                          <td className="px-2 py-2.5">
                            <span className="inline-flex items-center gap-2 font-mono text-ink text-[13px]">
                              <span
                                className="w-2 h-2 rounded-sm shrink-0"
                                style={{
                                  background:
                                    COMPARE_COLORS[i % COMPARE_COLORS.length],
                                }}
                              />
                              {c.name}
                            </span>
                          </td>
                          <td className="px-2 py-2.5 text-ink-2">
                            {t?.productName ?? c.productName}
                          </td>
                          <td className="px-2 py-2.5 text-right text-ink">
                            {usd(t?.spend)}
                          </td>
                          <td className="px-2 py-2.5 text-right text-ink-2">
                            {int(t?.impressions)}
                          </td>
                          <td className="px-2 py-2.5 text-right text-ink-2">
                            {pct(t?.ctr)}
                          </td>
                          <td className="px-2 py-2.5 text-right text-ink-2">
                            {usd(t?.cpa)}
                          </td>
                          <td className="px-2 py-2.5 text-right text-ink">
                            {ratio(t?.roas)}
                          </td>
                          <td className="px-2 py-2.5 text-right text-ink-2">
                            {pct(t?.hookRate)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
