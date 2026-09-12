import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { defaultDateRange } from "@/lib/date-presets";
import { resolvePreferredRange, resolveIncludeExcluded } from "@/db/queries/user-prefs";
import { angleRollup, angleByPlatform } from "@/db/queries/trends";
import { listProducts } from "@/db/queries/products";
import { listAllAngles } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { AngleRollupTable } from "@/components/trends/angle-rollup-table";
import { AngleScatter } from "@/components/trends/angle-scatter";
import { AngleLeaderboard } from "@/components/trends/angle-leaderboard";
import { AnglePlatformCompare } from "@/components/trends/angle-platform-compare";
import { dashboardFiltersSchema } from "@/validators/filters";
import { periodCaption } from "@/lib/period";

export const dynamic = "force-dynamic";

const TRAILING_DAYS_DEFAULT = 30;

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export const metadata = { title: "Trends · Angles" };

export default async function TrendsByAnglePage({
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

  const filters = {
    from,
    to,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
    includeExcluded,
  };

  const [rows, platformRows, products, angles] = await Promise.all([
    angleRollup(filters),
    angleByPlatform(filters),
    listProducts(),
    listAllAngles(),
  ]);

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
        backLink={{ href: "/trends", label: "Trends" }}
        title="Angles"
        subtitle={
          <>
            A creative counts toward every angle it carries. Spend Δ is{" "}
            {periodCaption(from, to)}.
          </>
        }
        rightSlot={
          <Badge variant="outline" className="text-ink-3">
            {from} → {to}
          </Badge>
        }
      />

      {/* Graphs: efficiency scatter + ranked leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AngleScatter rows={rows} />
        <AngleLeaderboard rows={rows} />
      </div>

      {/* Platform comparison — top angles per channel for a chosen metric */}
      <AnglePlatformCompare rows={platformRows} />

      {/* Full rollup — sortable, with a column selector */}
      <AngleRollupTable rows={rows} />
    </PageShell>
  );
}
