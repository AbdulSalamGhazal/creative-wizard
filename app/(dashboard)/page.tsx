import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  defaultDateRange,
  kpis,
  platformMix,
  spendByDatePlatform,
  topCreatives,
  type KpiFilters,
} from "@/db/queries/performance";
import { SpendOverTimeChart } from "@/components/charts/spend-over-time";
import { TopCreativesTable } from "@/components/charts/top-creatives";
import { PlatformMixDonut } from "@/components/charts/platform-mix";
import { usd, int, pct, ratio } from "@/lib/format";
import { dashboardFiltersSchema } from "@/validators/filters";

const TRAILING_DAYS_DEFAULT = 30;

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const parsed = dashboardFiltersSchema.parse({
    from: pickFirst(params.from),
    to: pickFirst(params.to),
    productIds: pickFirst(params.productIds),
    platforms: pickFirst(params.platforms),
    types: pickFirst(params.types),
    statuses: pickFirst(params.statuses),
    tags: pickFirst(params.tags),
    includeExcluded: pickFirst(params.includeExcluded),
  });

  const defaultRange = defaultDateRange(TRAILING_DAYS_DEFAULT);
  const from = parsed.from ?? defaultRange.from;
  const to = parsed.to ?? defaultRange.to;

  const filters: KpiFilters = {
    from,
    to,
    productIds: parsed.productIds,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    types: parsed.types.length > 0 ? parsed.types : undefined,
    statuses: parsed.statuses.length > 0 ? parsed.statuses : undefined,
    tags: parsed.tags.length > 0 ? parsed.tags : undefined,
    includeExcluded: parsed.includeExcluded,
  };

  const [k, spendRows, topRows, mixRows] = await Promise.all([
    kpis(filters),
    spendByDatePlatform(filters),
    topCreatives(filters, 10),
    platformMix(filters),
  ]);

  const tiles: Array<{ label: string; value: string }> = [
    { label: "Spend", value: usd(k.spend) },
    { label: "Impressions", value: int(k.impressions) },
    { label: "Blended CTR", value: pct(k.ctr) },
    { label: "Conversions", value: int(k.conversions) },
    { label: "Blended CPA", value: usd(k.cpa) },
    { label: "Blended ROAS", value: ratio(k.roas) },
  ];

  const platformsBadge =
    parsed.platforms.length > 0 ? parsed.platforms.join(", ") : "all platforms";

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Overview</h1>
          <p className="text-ink-2 text-sm mt-1">
            Aggregated performance across products, platforms, and creatives.
          </p>
        </div>
        <Badge variant="outline" className="text-ink-3">
          {from} → {to} · {platformsBadge} ·{" "}
          {parsed.includeExcluded ? "excluded shown" : "excluded hidden"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {tiles.map((t) => (
          <Card key={t.label} className="bg-surface border-line">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-[0.14em] text-ink-3 font-medium">
                {t.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-display text-4xl num text-ink leading-none">
                {t.value}
              </div>
              <div className="text-[11px] text-ink-3 mt-2">
                {from} → {to}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 bg-surface border-line">
          <CardHeader>
            <CardTitle className="text-sm">Spend over time</CardTitle>
          </CardHeader>
          <CardContent>
            <SpendOverTimeChart rows={spendRows} />
          </CardContent>
        </Card>
        <Card className="bg-surface border-line">
          <CardHeader>
            <CardTitle className="text-sm">Platform mix</CardTitle>
          </CardHeader>
          <CardContent>
            <PlatformMixDonut rows={mixRows} />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-surface border-line">
        <CardHeader>
          <CardTitle className="text-sm">Top creatives by spend</CardTitle>
        </CardHeader>
        <CardContent>
          <TopCreativesTable rows={topRows} />
        </CardContent>
      </Card>
    </div>
  );
}
