import { listCreatives, listAllTags } from "@/db/queries/creatives";
import { creativeStatusBreakdown } from "@/db/queries/creative-status";
import { listProducts } from "@/db/queries/products";
import { creativeListFiltersSchema } from "@/validators/creative";
import { LibraryHeader } from "@/components/creative/library-header";
import { LibraryFilterBar } from "@/components/creative/library-filter-bar";
import { CreativeGrid } from "@/components/creative/creative-grid";
import { CreativeTable } from "@/components/creative/creative-table";

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function CreativesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const parsed = creativeListFiltersSchema.parse({
    q: pickFirst(params.q),
    productIds: pickFirst(params.productIds),
    types: pickFirst(params.types),
    statuses: pickFirst(params.statuses),
    platforms: pickFirst(params.platforms),
    tags: pickFirst(params.tags),
    sort: pickFirst(params.sort),
    view: pickFirst(params.view),
  });

  const [listResult, breakdown, products, allTags] = await Promise.all([
    listCreatives({
      q: parsed.q,
      productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
      types: parsed.types.length > 0 ? parsed.types : undefined,
      statuses: parsed.statuses.length > 0 ? parsed.statuses : undefined,
      platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
      tags: parsed.tags.length > 0 ? parsed.tags : undefined,
      sort: parsed.sort,
    }),
    creativeStatusBreakdown(),
    listProducts(),
    listAllTags(),
  ]);

  // Carry the active filter/sort into each detail link so the detail page's
  // prev/next pager walks this exact same sequence (and "back" returns here).
  const ctxParams = new URLSearchParams();
  const ctxEntries: Array<[string, string]> = [
    ["q", parsed.q ?? ""],
    ["productIds", parsed.productIds.join(",")],
    ["types", parsed.types.join(",")],
    ["statuses", parsed.statuses.join(",")],
    ["platforms", parsed.platforms.join(",")],
    ["tags", parsed.tags.join(",")],
    ["sort", parsed.sort],
    ["view", parsed.view],
  ];
  for (const [key, val] of ctxEntries) {
    if (val) ctxParams.set(key, val);
  }
  const listCtx = ctxParams.toString();

  return (
    <div className="space-y-6">
      <LibraryHeader breakdown={breakdown} />
      <LibraryFilterBar products={products} tags={allTags} />

      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-3 num">
          Showing {listResult.rows.length} of {listResult.totalMatching} creatives
        </p>
      </div>

      {parsed.view === "table" ? (
        <CreativeTable rows={listResult.rows} listCtx={listCtx} />
      ) : (
        <CreativeGrid rows={listResult.rows} listCtx={listCtx} />
      )}
    </div>
  );
}
