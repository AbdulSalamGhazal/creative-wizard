import { Suspense } from "react";
import { int } from "@/lib/format";
import { portfolioParentCampaigns, type PortfolioFilters } from "@/db/queries/portfolio";
import { portfolioFiltersSchema } from "@/validators/portfolio";
import {
  resolvePreferredRange,
  resolveFilterPrefs,
  resolveIncludeExcluded,
  resolveTablePrefs,
} from "@/db/queries/user-prefs";
import { TABLE_KEYS, parseColumnList, resolveColumnPrefs } from "@/lib/table-columns";
import { VIEW_MARKER_PARAM, isSavedViewApplied } from "@/validators/user-prefs";
import { getDefaultSummaryView, listSummaryViews } from "@/db/queries/summary-views";
import { PARENT_CAMPAIGNS_VIEW_PAGE } from "@/lib/saved-view-href";
import { brandRedirect } from "@/lib/brand-redirect";
import { can, requireAuth } from "@/lib/auth";
import Link from "@/components/nav/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortfolioFilterBar } from "@/components/portfolio/portfolio-filter-bar";
import { PortfolioTable } from "@/components/portfolio/portfolio-table";
// Column META comes from the NON-client module: a server component may import
// a client COMPONENT, never a VALUE out of a `"use client"` file (it would be
// a client-reference proxy here, and reading it throws at request time —
// invisible to typecheck and to `next build`).
import { PORTFOLIO_LEVELS } from "@/components/portfolio/portfolio-columns";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { FilterBarSkeleton } from "@/components/layout/page-skeletons";
import { pickFirst } from "@/lib/url";
import { defaultDateRange } from "@/lib/date-presets";
import { AdDataGate } from "@/components/ui/no-ad-data-state";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
export const metadata = { title: "Campaigns" };

/**
 * Campaigns — one row per CAMPAIGN (a `parent_campaigns` row; 2026-11), its ad
 * sets rolled up: the level above the Ad sets list, drawn by the SAME table
 * and filter bar (`level="campaign"`). A campaign's numbers are the component
 * sums of its ad sets' records; it is active when any ad set is. A campaign
 * that has never run is listed too, so a just-registered one can be found.
 * Its saved views are its OWN (page key `parent_campaigns`) — the Ad sets
 * list keeps the stored key `campaigns`, and the two never mix.
 */
export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requireAuth();
  const level = PORTFOLIO_LEVELS.campaign;

  // Bare /campaigns (no params) lands on the caller's own default view, if
  // set — the Ad sets list's rule, with this list's own page key.
  if (Object.keys(params).length === 0) {
    const def = await getDefaultSummaryView(user.id, PARENT_CAMPAIGNS_VIEW_PAGE);
    if (def && def.query.trim().length > 0) {
      // The marker says "a saved view owns this state" — the remembered
      // filters below then no-op (transient, so it never lands in a view).
      return brandRedirect(`/campaigns?${def.query}&${VIEW_MARKER_PARAM}=${def.id}`);
    }
  }

  const rawFrom = pickFirst(params.from);
  const rawTo = pickFirst(params.to);
  // REMEMBERED FILTERS: URL wins, else this user's saved value for this brand,
  // else the page default — the same three keys as the Ad sets list, so a
  // platform picked on one is the other's too.
  const pref = await resolveFilterPrefs(
    [{ key: "platforms" }, { key: "objectives" }, { key: "statuses" }],
    (key: string) => pickFirst(params[key]),
  );

  // COLUMNS: URL → applied saved view → this user's preference → the config's
  // own order. The view suppression reuses the filters' `sv` marker, so a view
  // owns everything its URL states.
  const tablePrefs = await resolveTablePrefs([TABLE_KEYS.PARENT_CAMPAIGNS]);
  const columns = resolveColumnPrefs({
    url: {
      hidden: parseColumnList(pickFirst(params.hide)),
      order: parseColumnList(pickFirst(params.order)),
    },
    viewApplied: isSavedViewApplied((key: string) => pickFirst(params[key])),
    pref: tablePrefs[TABLE_KEYS.PARENT_CAMPAIGNS],
    hideable: [...level.columnKeys],
    defaults: [...level.columnKeys],
    defaultHidden: level.defaultHidden,
  });

  const parsed = portfolioFiltersSchema.parse({
    from: rawFrom,
    to: rawTo,
    platforms: pref.platforms,
    objectives: pref.objectives,
    statuses: pref.statuses,
    q: pickFirst(params.q),
    includeExcluded: pickFirst(params.includeExcluded),
    sort: pickFirst(params.sort),
    dir: pickFirst(params.dir),
    hide: pickFirst(params.hide),
    order: pickFirst(params.order),
  });

  // Effective Excluded state: URL param wins, else the user's saved default.
  const includeExcluded = await resolveIncludeExcluded(pickFirst(params.includeExcluded));

  // Explicit URL range wins; otherwise the saved default; otherwise last-7 —
  // the house resolver every range page uses (W3-7).
  const { from, to } = await resolvePreferredRange(rawFrom, rawTo, defaultDateRange());

  const filters: PortfolioFilters = {
    from,
    to,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    objectives: parsed.objectives.length > 0 ? parsed.objectives : undefined,
    statuses: parsed.statuses.length > 0 ? parsed.statuses : undefined,
    q: parsed.q,
    includeExcluded,
  };

  const [campaigns, views] = await Promise.all([
    portfolioParentCampaigns(filters),
    listSummaryViews(user.id, PARENT_CAMPAIGNS_VIEW_PAGE),
  ]);
  const table = (
    <PortfolioTable
      level="campaign"
      rows={campaigns}
      sort={parsed.sort}
      dir={parsed.dir}
      hidden={columns.hidden}
      order={columns.order}
    />
  );

  return (
    <PageShell>
      <PageHeader
        title="Campaigns"
        subtitle={
          <span className="tabular-nums">
            {int(campaigns.length)} campaign
            {campaigns.length === 1 ? "" : "s"}
          </span>
        }
        rightSlot={
          can(user, "campaign.create") ? (
            <Button asChild>
              <Link href="/campaigns/new">
                <Plus className="w-4 h-4" /> New campaign
              </Link>
            </Button>
          ) : undefined
        }
      />

      <Suspense fallback={<FilterBarSkeleton />}>
        <PortfolioFilterBar
          level="campaign"
          resolvedFilters={pref}
          includeExcludedDefault={includeExcluded}
          defaultFrom={from}
          defaultTo={to}
          views={views}
          currentUserId={user.id}
          isAdmin={user.role === "admin"}
        />
      </Suspense>

      {/* A brand with no ad data yet still LISTS its registered campaigns —
          they are registered before the first upload, and must be findable.
          Only an empty list falls back to the first-use / filtered state. */}
      {campaigns.length > 0 ? (
        table
      ) : (
        <AdDataGate>{table}</AdDataGate>
      )}
    </PageShell>
  );
}
