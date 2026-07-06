import { redirect } from "next/navigation";
import { listCreatives, listAllTags } from "@/db/queries/creatives";
import { creativeStatusBreakdown } from "@/db/queries/creative-status";
import { listProducts } from "@/db/queries/products";
import {
  getDefaultSummaryView,
  listSummaryViews,
} from "@/db/queries/summary-views";
import { can, requireAuth } from "@/lib/auth";
import { creativeListFiltersSchema } from "@/validators/creative";
import { LibraryHeader } from "@/components/creative/library-header";
import { LibraryFilterBar } from "@/components/creative/library-filter-bar";
import { PageShell } from "@/components/layout/page-shell";
import { CreativeGrid } from "@/components/creative/creative-grid";
import { CreativeTable } from "@/components/creative/creative-table";

export const dynamic = "force-dynamic";

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
  const user = await requireAuth();

  // Bare /creatives (no params) lands on the caller's own default view, if set.
  if (Object.keys(params).length === 0) {
    const def = await getDefaultSummaryView(user.id, "creatives");
    if (def && def.query.trim().length > 0) {
      redirect(`/creatives?${def.query}`);
    }
  }

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

  const [listResult, breakdown, products, allTags, views] = await Promise.all([
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
    listSummaryViews(user.id, "creatives"),
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
    <PageShell>
      <LibraryHeader
        breakdown={breakdown}
        canCreate={can(user, "creative.create")}
      />
      <LibraryFilterBar
        products={products}
        tags={allTags}
        views={views}
        currentUserId={user.id}
        isAdmin={user.role === "admin"}
      />

      {parsed.view === "table" ? (
        <CreativeTable
          rows={listResult.rows}
          total={listResult.totalMatching}
          listCtx={listCtx}
        />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-ink-3 num">
            Showing {listResult.rows.length} of {listResult.totalMatching}{" "}
            creatives
          </p>
          <CreativeGrid rows={listResult.rows} listCtx={listCtx} />
        </div>
      )}
    </PageShell>
  );
}
