import { redirect } from "next/navigation";
import { listAllTags } from "@/db/queries/creatives";
import { listProducts } from "@/db/queries/products";
import { listCreativeSummary } from "@/db/queries/summary";
import { getRatingConfig } from "@/db/queries/rating";
import {
  getDefaultSummaryView,
  listSummaryViews,
} from "@/db/queries/summary-views";
import { summaryFiltersSchema } from "@/validators/summary";
import { requireAuth } from "@/lib/auth";
import { SummaryFilterBar } from "@/components/summary/summary-filter-bar";
import { SummaryTable } from "@/components/summary/summary-table";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requireAuth();

  // Default-view redirect: a bare /summary (no params at all) lands on the
  // caller's OWN default view, if they set one with a non-empty config. The
  // explicit `?view=none` escape hatch (from "Show all" in the Views control)
  // skips this so the unfiltered table stays reachable.
  if (Object.keys(params).length === 0) {
    const def = await getDefaultSummaryView(user.id, "summary");
    if (def && def.query.trim().length > 0) {
      redirect(`/summary?${def.query}`);
    }
  }

  const parsed = summaryFiltersSchema.parse({
    from: pickFirst(params.from),
    to: pickFirst(params.to),
    q: pickFirst(params.q),
    productIds: pickFirst(params.productIds),
    platforms: pickFirst(params.platforms),
    types: pickFirst(params.types),
    tags: pickFirst(params.tags),
    creatorIds: pickFirst(params.creatorIds),
    includeExcluded: pickFirst(params.includeExcluded),
    sort: pickFirst(params.sort),
    dir: pickFirst(params.dir),
    hideIdentity: pickFirst(params.hideIdentity),
    hideMetrics: pickFirst(params.hideMetrics),
    hideRate: pickFirst(params.hideRate),
    hideBlended: pickFirst(params.hideBlended),
    metricFilters: pickFirst(params.metricFilters),
    rate: pickFirst(params.rate),
    status: pickFirst(params.status),
  });

  // Rating config (default + per-platform overrides) feeds the Rate column and
  // the rate sort/filter, so fetch it first and hand it to the summary query.
  const ratingConfig = await getRatingConfig();

  // Filter dropdowns + the query run in parallel.
  const [
    { rows, platforms: selectedPlatforms, effectiveSort },
    products,
    tags,
    views,
  ] = await Promise.all([
    listCreativeSummary({
      from: parsed.from,
      to: parsed.to,
      q: parsed.q,
      productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
      platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
      types: parsed.types.length > 0 ? parsed.types : undefined,
      tags: parsed.tags.length > 0 ? parsed.tags : undefined,
      creatorIds: parsed.creatorIds.length > 0 ? parsed.creatorIds : undefined,
      includeExcluded: parsed.includeExcluded,
      sort: parsed.sort,
      dir: parsed.dir,
      metricFilters:
        parsed.metricFilters.length > 0 ? parsed.metricFilters : undefined,
      rateFilter: parsed.rate,
      statusFilter: parsed.status,
      ratingConfig,
    }),
    listProducts(),
    listAllTags(),
    listSummaryViews(user.id, "summary"),
  ]);

  // Reconstruct the base URLSearchParams for sort-link href computation.
  const baseParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && v) baseParams.set(k, v);
  }

  const rangeLabel =
    parsed.from && parsed.to
      ? `${parsed.from} → ${parsed.to}`
      : "all time";
  const platformsLabel =
    selectedPlatforms.length === parsed.platforms.length || parsed.platforms.length === 0
      ? "default platforms"
      : `${selectedPlatforms.join(", ")}`;

  return (
    <div className="space-y-4">
      <SummaryFilterBar
        products={products}
        tags={tags}
        effectivePlatforms={selectedPlatforms}
        views={views}
        currentUserId={user.id}
        isAdmin={user.role === "admin"}
      />

      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Summary</h1>
          <p className="text-ink-2 text-sm mt-1">
            Every creative, every metric, side-by-side across platforms.{" "}
            <span className="text-ink-3">
              {rows.length.toLocaleString()} creative{rows.length === 1 ? "" : "s"}
              {" · "}
              {rangeLabel}
              {" · "}
              {platformsLabel}
            </span>
          </p>
        </div>
        <div className="text-[11px] text-ink-3 font-mono">
          Sorted by {effectiveSort.key} {effectiveSort.dir}
        </div>
      </div>

      <SummaryTable
        rows={rows}
        platforms={selectedPlatforms}
        sort={effectiveSort}
        pathname="/summary"
        baseParams={baseParams.toString()}
        hiddenIdentity={new Set(parsed.hideIdentity)}
        hiddenMetrics={new Set(parsed.hideMetrics)}
        ratingConfig={ratingConfig}
        showRate={!parsed.hideRate}
        showBlended={!parsed.hideBlended}
      />
    </div>
  );
}
