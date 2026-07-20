import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { defaultDateRange } from "@/lib/date-presets";
import { resolvePreferredRange } from "@/db/queries/user-prefs";
import { tagRollup, tagByPlatform } from "@/db/queries/trends";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { TagRollupTable } from "@/components/trends/tag-rollup-table";
import { TagScatter } from "@/components/trends/tag-scatter";
import { TagLeaderboard } from "@/components/trends/tag-leaderboard";
import { TagPlatformCompare } from "@/components/trends/tag-platform-compare";
import { dashboardFiltersSchema } from "@/validators/filters";
import { periodCaption } from "@/lib/period";

export const dynamic = "force-dynamic";

const TRAILING_DAYS_DEFAULT = 30;

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export const metadata = { title: "Trends · Tags" };

export default async function TrendsByTagPage({
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
    includeExcluded: parsed.includeExcluded,
  };

  const [rows, platformRows, products, tags] = await Promise.all([
    tagRollup(filters),
    tagByPlatform(filters),
    listProducts(),
    listAllTags(),
  ]);

  return (
    <PageShell
      filterStrip={
        <FilterStrip
          products={products}
          tags={tags}
          defaultFrom={from}
          defaultTo={to}
        />
      }
    >
      <PageHeader
        backLink={{ href: "/trends", label: "Trends" }}
        title="Tags"
        subtitle={
          <>
            A creative counts toward every tag it carries. Spend Δ is{" "}
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
        <TagScatter rows={rows} />
        <TagLeaderboard rows={rows} />
      </div>

      {/* Platform comparison — top tags per channel for a chosen metric */}
      <TagPlatformCompare rows={platformRows} />

      {/* Full rollup — sortable, with a column selector */}
      <TagRollupTable rows={rows} />
    </PageShell>
  );
}
