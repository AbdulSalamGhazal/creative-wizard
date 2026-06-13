import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
    <div className="space-y-6">
      <Suspense
        fallback={<div className="-mx-6 px-6 h-12 border-b border-line bg-background/95" />}
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
          <Link
            href="/trends"
            className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink transition-colors mb-2"
          >
            <ArrowLeft className="w-3 h-3" />
            Trends
          </Link>
          <h1 className="font-display text-4xl tracking-tight">Tags</h1>
          <p className="text-ink-2 text-sm mt-1">
            Performance rolled up by tag. A creative counts toward every tag it
            carries. Spend Δ is {periodCaption(from, to)}. Click a tag to open
            the filtered Library.
          </p>
        </div>
        <Badge variant="outline" className="text-ink-3">
          {from} → {to}
        </Badge>
      </div>

      {/* Graphs: efficiency scatter + ranked leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TagScatter rows={rows} />
        <TagLeaderboard rows={rows} />
      </div>

      {/* Platform comparison — top tags per channel for a chosen metric */}
      <TagPlatformCompare rows={platformRows} />

      {/* Full rollup — sortable, with a column selector */}
      <TagRollupTable rows={rows} />
    </div>
  );
}
