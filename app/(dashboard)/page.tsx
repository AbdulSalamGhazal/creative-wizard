import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { type KpiFilters } from "@/db/queries/performance";
import { defaultDateRange } from "@/lib/date-presets";
import { resolvePreferredRange, resolveIncludeExcluded } from "@/db/queries/user-prefs";
import { listProducts } from "@/db/queries/products";
import { listAllAngles } from "@/db/queries/creatives";
import { DashboardMetrics } from "@/components/overview/dashboard-metrics";
import { OverviewSection } from "@/components/overview/overview-section";
import { FilterStrip } from "@/components/filters/filter-strip";
import { dashboardFiltersSchema } from "@/validators/filters";
import { PLATFORM_LABEL } from "@/lib/palette";
import { ViewComments } from "@/components/comments/view-comments";

const TRAILING_DAYS_DEFAULT = 30;

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export const metadata = { title: "Dashboard" };

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
    angles: pickFirst(params.angles),
    includeExcluded: pickFirst(params.includeExcluded),
  });

  // Effective Excluded state: URL param wins, else the user's saved default.
  const includeExcluded = await resolveIncludeExcluded(
    pickFirst(params.includeExcluded),
  );

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
    angles: parsed.angles.length > 0 ? parsed.angles : undefined,
    includeExcluded,
  };

  // When the view is pinned to exactly ONE platform, the metric breakdowns
  // drill one level deeper — by campaign within that platform. Otherwise they
  // break down by platform.
  const singlePlatform = parsed.platforms.length === 1 ? parsed.platforms[0] : null;
  const dimension = singlePlatform ? "campaign" : "platform";

  const platformsBadge =
    parsed.platforms.length > 0 ? parsed.platforms.join(", ") : "all platforms";

  const [products, angles] = await Promise.all([listProducts(), listAllAngles()]);

  return (
    <PageShell
      filterStrip={
        <FilterStrip
          includeExcludedDefault={includeExcluded}
          products={products}
          angles={angles}
          defaultFrom={from}
          defaultTo={to}
        />
      }
    >
      <PageHeader
        title="Dashboard"
        rightSlot={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-ink-3">
              {from} → {to} · {platformsBadge} ·{" "}
              {includeExcluded ? "excluded shown" : "excluded hidden"}
            </Badge>
            <ViewComments path="/" />
          </div>
        }
      />

      <DashboardMetrics filters={filters} dimension={dimension} />

      <OverviewSection
        filters={filters}
        dimension={dimension}
        dimensionLabel={singlePlatform ? PLATFORM_LABEL[singlePlatform] : undefined}
        rangeFrom={pickFirst(params.from)}
        rangeTo={pickFirst(params.to)}
      />
    </PageShell>
  );
}
