import { listAllTags } from "@/db/queries/creatives";
import { listProducts } from "@/db/queries/products";
import { listCreators } from "@/db/queries/users";
import { listCreativeSummary } from "@/db/queries/summary";
import { summaryFiltersSchema } from "@/validators/summary";
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
  const parsed = summaryFiltersSchema.parse({
    from: pickFirst(params.from),
    to: pickFirst(params.to),
    q: pickFirst(params.q),
    productIds: pickFirst(params.productIds),
    platforms: pickFirst(params.platforms),
    types: pickFirst(params.types),
    statuses: pickFirst(params.statuses),
    tags: pickFirst(params.tags),
    creatorIds: pickFirst(params.creatorIds),
    includeExcluded: pickFirst(params.includeExcluded),
    sort: pickFirst(params.sort),
    dir: pickFirst(params.dir),
    hideIdentity: pickFirst(params.hideIdentity),
    hideMetrics: pickFirst(params.hideMetrics),
  });

  // Filter dropdowns + the query run in parallel.
  const [{ rows, platforms: selectedPlatforms, effectiveSort }, products, tags, creators] =
    await Promise.all([
      listCreativeSummary({
        from: parsed.from,
        to: parsed.to,
        q: parsed.q,
        productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
        platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
        types: parsed.types.length > 0 ? parsed.types : undefined,
        statuses: parsed.statuses.length > 0 ? parsed.statuses : undefined,
        tags: parsed.tags.length > 0 ? parsed.tags : undefined,
        creatorIds: parsed.creatorIds.length > 0 ? parsed.creatorIds : undefined,
        includeExcluded: parsed.includeExcluded,
        sort: parsed.sort,
        dir: parsed.dir,
      }),
      listProducts(),
      listAllTags(),
      listCreators(),
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
      <SummaryFilterBar products={products} tags={tags} creators={creators} />

      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Summary</h1>
          <p className="text-ink-2 text-sm mt-1">
            Every creative, every metric, side-by-side across up to 3 platforms.{" "}
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
        baseParams={baseParams}
        hiddenIdentity={new Set(parsed.hideIdentity)}
        hiddenMetrics={new Set(parsed.hideMetrics)}
      />
    </div>
  );
}
