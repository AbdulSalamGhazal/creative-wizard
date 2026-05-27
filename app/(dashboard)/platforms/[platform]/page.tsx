import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  defaultDateRange,
  kpis,
  spendByDatePlatform,
  topCreatives,
  platformMix,
} from "@/db/queries/performance";
import { SpendOverTimeChart } from "@/components/charts/spend-over-time";
import { TopCreativesTable } from "@/components/charts/top-creatives";
import { PlatformMixDonut } from "@/components/charts/platform-mix";
import { PLATFORM_COLOR, PLATFORM_LABEL, ALL_PLATFORMS } from "@/lib/palette";
import { dashboardFiltersSchema } from "@/validators/filters";
import { int, pct, ratio, usd } from "@/lib/format";

const TRAILING = 30;

type SearchParams = Record<string, string | string[] | undefined>;
type Platform = (typeof ALL_PLATFORMS)[number];

function pickFirst(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function PerPlatformPage({
  params,
  searchParams,
}: {
  params: Promise<{ platform: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { platform: paramPlatform } = await params;
  if (!ALL_PLATFORMS.includes(paramPlatform as Platform)) {
    notFound();
  }
  const platform = paramPlatform as Platform;

  const sp = await searchParams;
  const parsed = dashboardFiltersSchema.parse({
    from: pickFirst(sp.from),
    to: pickFirst(sp.to),
    productIds: pickFirst(sp.productIds),
    platforms: undefined, // ignored; this page forces one platform
    types: pickFirst(sp.types),
    statuses: pickFirst(sp.statuses),
    tags: pickFirst(sp.tags),
    includeExcluded: pickFirst(sp.includeExcluded),
  });
  const range = defaultDateRange(TRAILING);
  const from = parsed.from ?? range.from;
  const to = parsed.to ?? range.to;

  const filters = {
    from,
    to,
    productIds: parsed.productIds,
    platforms: [platform] as const as Platform[],
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

  const isVideoHeavy = platform === "meta" || platform === "tiktok";

  const tiles: Array<{ label: string; value: string }> = [
    { label: "Spend", value: usd(k.spend) },
    { label: "Impressions", value: int(k.impressions) },
    { label: "Blended CTR", value: pct(k.ctr) },
    { label: "Conversions", value: int(k.conversions) },
    { label: "Blended CPA", value: usd(k.cpa) },
    isVideoHeavy
      ? { label: "Hook rate", value: pct(k.hookRate) }
      : { label: "Blended ROAS", value: ratio(k.roas) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1 flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-sm"
              style={{ background: PLATFORM_COLOR[platform] }}
            />
            Platform · {PLATFORM_LABEL[platform]}
          </div>
          <h1 className="font-display text-4xl tracking-tight">
            {PLATFORM_LABEL[platform]} performance
          </h1>
          <p className="text-ink-2 text-sm mt-1">
            Scoped to {PLATFORM_LABEL[platform]}. Filters and excluded-toggle
            still apply.
          </p>
        </div>
        <Badge variant="outline" className="text-ink-3">
          {from} → {to}
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
            <CardTitle className="text-sm">Slice</CardTitle>
          </CardHeader>
          <CardContent>
            <PlatformMixDonut rows={mixRows} />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-surface border-line">
        <CardHeader>
          <CardTitle className="text-sm">
            Top creatives on {PLATFORM_LABEL[platform]}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TopCreativesTable rows={topRows} />
        </CardContent>
      </Card>
    </div>
  );
}
