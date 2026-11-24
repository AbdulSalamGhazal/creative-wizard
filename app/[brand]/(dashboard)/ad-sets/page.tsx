import { brandRedirect } from "@/lib/brand-redirect";
import { Suspense } from "react";
import { int } from "@/lib/format";
import {
  portfolioCampaignList,
  type PortfolioFilters,
} from "@/db/queries/portfolio";
import { portfolioFiltersSchema } from "@/validators/portfolio";
import {
  resolvePreferredRange,
  resolveFilterPrefs,
  resolveIncludeExcluded,
  resolveTablePrefs,
} from "@/db/queries/user-prefs";
import { VIEW_MARKER_PARAM, isSavedViewApplied } from "@/validators/user-prefs";
import {
  TABLE_KEYS,
  parseColumnList,
  resolveColumnPrefs,
} from "@/lib/table-columns";
import {
  getDefaultSummaryView,
  listSummaryViews,
} from "@/db/queries/summary-views";
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
import { CAMPAIGN_TABLE_COLUMNS } from "@/components/portfolio/portfolio-columns";
import { CAMPAIGN_DEFAULT_HIDDEN } from "@/components/portfolio/portfolio-columns";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { FilterBarSkeleton } from "@/components/layout/page-skeletons";
import { pickFirst } from "@/lib/url";
import { defaultDateRange } from "@/lib/date-presets";
import { AdDataGate } from "@/components/ui/no-ad-data-state";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
export const metadata = { title: "Ad sets" };

/**
 * Ad sets — a single rich table, one row per AD SET (a `campaigns` row; the
 * level under a Campaign — lib/campaign.ts, "TWO LEVELS"), with the same
 * toolkit as Summary: saved/custom views, URL-driven sort, column visibility,
 * and the date/platform/search filters. Until 2026-11 this page WAS
 * `/campaigns`; its saved views keep their stored key (`campaigns`).
 */
export default async function AdSetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requireAuth();

  // Bare /ad-sets (no params) lands on the caller's own default view, if set.
  if (Object.keys(params).length === 0) {
    const def = await getDefaultSummaryView(user.id, "campaigns");
    if (def && def.query.trim().length > 0) {
      // The marker says "a saved view owns this state" — the remembered
      // filters below then no-op (transient, so it never lands in a view).
      return brandRedirect(`/ad-sets?${def.query}&${VIEW_MARKER_PARAM}=${def.id}`);
    }
  }

  const rawFrom = pickFirst(params.from);
  const rawTo = pickFirst(params.to);
  // REMEMBERED FILTERS (migration 0049): URL wins, else this user's saved value
  // for this brand, else the page default — the date range's rule, generalized.
  // Suppressed while a saved view is applied, or once the URL states its
  // filters in full. All three keys have fixed vocabularies, so the validator
  // below is the guard against a retired value.
  const pref = await resolveFilterPrefs(
    [{ key: "platforms" }, { key: "objectives" }, { key: "statuses" }],
    (key: string) => pickFirst(params[key]),
  );

  // COLUMNS follow the same architecture as the filters, with one more step:
  // URL → applied saved view → this user's preference → the config's own
  // order. The view suppression reuses the filters' `sv` marker rather than a
  // parallel one, so a view still owns everything its URL states.
  const tablePrefs = await resolveTablePrefs([TABLE_KEYS.CAMPAIGNS]);
  const columns = resolveColumnPrefs({
    url: {
      hidden: parseColumnList(pickFirst(params.hide)),
      order: parseColumnList(pickFirst(params.order)),
    },
    viewApplied: isSavedViewApplied((key: string) => pickFirst(params[key])),
    pref: tablePrefs[TABLE_KEYS.CAMPAIGNS],
    hideable: CAMPAIGN_TABLE_COLUMNS.map((c) => c.key),
    defaults: CAMPAIGN_TABLE_COLUMNS.map((c) => c.key),
    // The free columns (2026-11) start hidden; `hide` opts one in as `!key`.
    defaultHidden: CAMPAIGN_DEFAULT_HIDDEN,
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
  const includeExcluded = await resolveIncludeExcluded(
    pickFirst(params.includeExcluded),
  );

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

  const [{ rows: campaigns, creativesTotal }, views] = await Promise.all([
    portfolioCampaignList(filters),
    listSummaryViews(user.id, "campaigns"),
  ]);

  return (
    <PageShell>
      <PageHeader
        title="Ad sets"
        subtitle={
          <span className="tabular-nums">
            {int(campaigns.length)} ad set
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
          resolvedFilters={pref}
          includeExcludedDefault={includeExcluded}
          defaultFrom={from}
          defaultTo={to}
          views={views}
          currentUserId={user.id}
          isAdmin={user.role === "admin"}
        />
      </Suspense>

      <AdDataGate>
        <PortfolioTable
          rows={campaigns}
          creativesTotal={creativesTotal}
          sort={parsed.sort}
          dir={parsed.dir}
          hidden={columns.hidden}
          order={columns.order}
        />
      </AdDataGate>
    </PageShell>
  );
}
