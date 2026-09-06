import { redirect } from "next/navigation";
import { listCreatives, listAllAngles } from "@/db/queries/creatives";
import { listAngles } from "@/db/queries/angles";
import { ProductsAdmin } from "@/components/product/products-admin";
import { AnglesTable } from "@/components/angle/angles-table";
import { PageTabs, type PageTab } from "@/components/layout/page-tabs";
import type { Permission } from "@/lib/permissions";
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
import { resolveIncludeExcluded } from "@/db/queries/user-prefs";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export const metadata = { title: "Creatives" };

/**
 * The page's tab row. Products and Angles are the vocabulary-management
 * surfaces relocated from Configuration in the 2026-09 IA pass: they describe
 * creatives, so they now live with them instead of in a separate admin page.
 * Each is gated by the same permission it always was, so the tab is invisible
 * (and its content unreachable) without it. Creatives is always present.
 */
const TABS = [
  { key: "creatives", label: "Creatives", perm: null },
  { key: "products", label: "Products", perm: "catalog.products" },
  { key: "angles", label: "Angles", perm: "catalog.angles" },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  perm: Permission | null;
}>;
type TabKey = (typeof TABS)[number]["key"];

export default async function CreativesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requireAuth();

  // The Creatives tab links to the BARE route on purpose: `?tab=creatives`
  // would count as a param and suppress the default-view redirect below.
  const tabs: PageTab[] = TABS.filter((t) => !t.perm || can(user, t.perm)).map(
    (t) => ({
      key: t.key,
      label: t.label,
      href: t.key === "creatives" ? "/creatives" : `/creatives?tab=${t.key}`,
    }),
  );
  const requestedTab = pickFirst(params.tab);
  const activeTab: TabKey = tabs.some((t) => t.key === requestedTab)
    ? (requestedTab as TabKey)
    : "creatives";

  // Products / Angles are self-contained admin surfaces — return before the
  // listing's queries so switching tabs doesn't pay for the creative list.
  if (activeTab !== "creatives") {
    return (
      <PageShell>
        <LibraryHeader
          breakdown={await creativeStatusBreakdown()}
          canCreate={can(user, "creative.create")}
        />
        <PageTabs tabs={tabs} active={activeTab} />
        {activeTab === "products" && <ProductsAdmin />}
        {activeTab === "angles" && <AnglesTable rows={await listAngles()} />}
      </PageShell>
    );
  }

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
    angles: pickFirst(params.angles),
    sort: pickFirst(params.sort),
    view: pickFirst(params.view),
  });

  // Effective Excluded state: URL param wins, else the user's saved default.
  // Governs the 7d/30d spend columns only (the list itself isn't an aggregate).
  const includeExcluded = await resolveIncludeExcluded(
    pickFirst(params.includeExcluded),
  );

  const [listResult, breakdown, products, allAngles, views] = await Promise.all([
    listCreatives({
      q: parsed.q,
      productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
      types: parsed.types.length > 0 ? parsed.types : undefined,
      statuses: parsed.statuses.length > 0 ? parsed.statuses : undefined,
      platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
      angles: parsed.angles.length > 0 ? parsed.angles : undefined,
      sort: parsed.sort,
      includeExcluded,
    }),
    creativeStatusBreakdown(),
    listProducts(),
    listAllAngles(),
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
    ["angles", parsed.angles.join(",")],
    ["sort", parsed.sort],
    ["view", parsed.view],
    ["includeExcluded", includeExcluded ? "1" : ""],
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
      <PageTabs tabs={tabs} active={activeTab} />
      <LibraryFilterBar
        products={products}
        angles={allAngles}
        includeExcluded={includeExcluded}
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
