import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { type KpiFilters } from "@/db/queries/performance";
import { defaultDateRange } from "@/lib/date-presets";
import { resolvePreferredRange } from "@/db/queries/user-prefs";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { DashboardMetrics } from "@/components/overview/dashboard-metrics";
import { OverviewSection } from "@/components/overview/overview-section";
import { FilterStrip } from "@/components/filters/filter-strip";
import { dashboardFiltersSchema } from "@/validators/filters";
import { PLATFORM_LABEL } from "@/lib/palette";

const TRAILING_DAYS_DEFAULT = 30;

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function DashboardPage({
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
    tags: pickFirst(params.tags),
    includeExcluded: pickFirst(params.includeExcluded),
  });

  const range = await resolvePreferredRange(
    pickFirst(params.from),
    pickFirst(params.to),
    defaultDateRange(TRAILING_DAYS_DEFAULT),
  );
  const from = range.from;
  const to = range.to;

  const filters: KpiFilters = {
    from,
    to,
    productIds: parsed.productIds,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    types: parsed.types.length > 0 ? parsed.types : undefined,
    tags: parsed.tags.length > 0 ? parsed.tags : undefined,
    includeExcluded: parsed.includeExcluded,
  };

  // When the view is pinned to exactly ONE platform, the metric breakdowns
  // drill one level deeper — by campaign within that platform. Otherwise they
  // break down by platform.
  const singlePlatform = parsed.platforms.length === 1 ? parsed.platforms[0] : null;
  const dimension = singlePlatform ? "campaign" : "platform";

  const platformsBadge =
    parsed.platforms.length > 0 ? parsed.platforms.join(", ") : "all platforms";

  const [products, tags] = await Promise.all([listProducts(), listAllTags()]);

  return (
    <div className="space-y-6">
      <Suspense
        fallback={
          <div className="-mx-6 px-6 h-12 border-b border-line bg-background/95 backdrop-blur" />
        }
      >
        <div className="-mx-6 -mt-6 mb-2">
          <FilterStrip
            products={products}
            tags={tags}
            defaultFrom={from}
            defaultTo={to}
          />
        </div>
      </Suspense>

      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Dashboard</h1>
        </div>
        <Badge variant="outline" className="text-ink-3">
          {from} → {to} · {platformsBadge} ·{" "}
          {parsed.includeExcluded ? "excluded shown" : "excluded hidden"}
        </Badge>
      </div>

      <DashboardMetrics filters={filters} dimension={dimension} />

      <OverviewSection
        filters={filters}
        dimension={dimension}
        dimensionLabel={singlePlatform ? PLATFORM_LABEL[singlePlatform] : undefined}
      />
    </div>
  );
}
