import { asc } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { creatives } from "@/db/schema";
import {
  compareSeries,
  compareTotals,
  type CompareMetric,
} from "@/db/queries/performance";
import { CompareControls } from "@/components/creative/compare-controls";
import { CompareChart, COMPARE_COLORS } from "@/components/charts/compare-chart";
import { int, pct, ratio, usd } from "@/lib/format";

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

const VALID_METRICS: CompareMetric[] = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "ctr",
  "cpm",
  "cpc",
  "cpa",
  "roas",
  "hookRate",
];

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const creativeIdsRaw = pickFirst(params.creativeIds);
  const selected = creativeIdsRaw
    ? creativeIdsRaw.split(",").filter(Boolean).slice(0, 5)
    : [];
  const metricRaw = pickFirst(params.metric);
  const metric: CompareMetric = VALID_METRICS.includes(metricRaw as CompareMetric)
    ? (metricRaw as CompareMetric)
    : "spend";

  const allCreatives = await db
    .select({ id: creatives.id, name: creatives.name })
    .from(creatives)
    .orderBy(asc(creatives.name));

  const validSelected = selected.filter((id) =>
    allCreatives.some((c) => c.id === id),
  );

  const [series, totals] = await Promise.all([
    validSelected.length >= 1
      ? compareSeries({ creativeIds: validSelected, metric })
      : Promise.resolve([]),
    validSelected.length >= 1
      ? compareTotals({ creativeIds: validSelected })
      : Promise.resolve([]),
  ]);

  const orderedCreatives = validSelected
    .map((id) => allCreatives.find((c) => c.id === id))
    .filter((c): c is { id: string; name: string } => !!c);

  // Sort totals to match the picked order
  const totalsByName = new Map(totals.map((t) => [t.creativeId, t]));

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
          Select up to five creatives and a metric. All blended figures are
          weighted via component sums (tech-spec §8.2).
        </p>
      </div>

      <CompareControls
        allCreatives={allCreatives}
        selected={validSelected}
        metric={metric}
      />

      <Card className="bg-surface border-line">
        <CardHeader>
          <CardTitle className="text-sm">
            Daily trend ·{" "}
            <span className="text-ink-3 font-normal">
              {metricLabel(metric)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CompareChart
            rows={series}
            creatives={orderedCreatives}
            metric={metric}
          />
        </CardContent>
      </Card>

      {orderedCreatives.length > 0 && (
        <Card className="bg-surface border-line">
          <CardHeader>
            <CardTitle className="text-sm">All-time comparison</CardTitle>
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
                    const t = totalsByName.get(c.id);
                    return (
                      <tr key={c.id} className="hover:bg-surface-2/60 transition-colors">
                        <td className="px-2 py-2.5">
                          <span className="inline-flex items-center gap-2 font-mono text-ink text-[13px]">
                            <span
                              className="w-2 h-2 rounded-sm shrink-0"
                              style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }}
                            />
                            {c.name}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-ink-2">
                          {t?.productName ?? "—"}
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
      )}
    </div>
  );
}

function metricLabel(m: CompareMetric): string {
  return {
    spend: "Spend",
    impressions: "Impressions",
    clicks: "Clicks",
    conversions: "Conversions",
    ctr: "Click-through rate",
    cpm: "CPM",
    cpc: "CPC",
    cpa: "CPA",
    roas: "ROAS",
    hookRate: "Hook rate",
  }[m];
}
