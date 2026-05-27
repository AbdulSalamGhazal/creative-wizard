import {
  listCreatives,
  creativeStats,
  listAllTags,
} from "@/db/queries/creatives";
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
    tags: pickFirst(params.tags),
    sort: pickFirst(params.sort),
    view: pickFirst(params.view),
  });

  const [listResult, stats, products, allTags] = await Promise.all([
    listCreatives({
      q: parsed.q,
      productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
      types: parsed.types.length > 0 ? parsed.types : undefined,
      statuses: parsed.statuses.length > 0 ? parsed.statuses : undefined,
      tags: parsed.tags.length > 0 ? parsed.tags : undefined,
      sort: parsed.sort,
    }),
    creativeStats(),
    listProducts(),
    listAllTags(),
  ]);

  return (
    <div className="space-y-6">
      <LibraryHeader stats={stats} />
      <LibraryFilterBar products={products} tags={allTags} />

      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-3 num">
          Showing {listResult.rows.length} of {listResult.totalMatching} creatives
        </p>
      </div>

      {parsed.view === "table" ? (
        <CreativeTable rows={listResult.rows} />
      ) : (
        <CreativeGrid rows={listResult.rows} />
      )}
    </div>
  );
}
