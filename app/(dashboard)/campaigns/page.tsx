import { Suspense } from "react";
import { int } from "@/lib/format";
import { redirect } from "next/navigation";
import {
  portfolioCampaigns,
  type PortfolioFilters,
} from "@/db/queries/portfolio";
import { portfolioFiltersSchema } from "@/validators/portfolio";
import { getPreferredRange } from "@/db/queries/user-prefs";
import {
  getDefaultSummaryView,
  listSummaryViews,
} from "@/db/queries/summary-views";
import { requireAuth } from "@/lib/auth";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortfolioFilterBar } from "@/components/portfolio/portfolio-filter-bar";
import { PortfolioTable } from "@/components/portfolio/portfolio-table";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Campaigns — a single rich table, one row per campaign, with the same toolkit
 * as Summary: saved/custom views, URL-driven sort, column visibility, and the
 * date/platform/search filters. (The old portfolio scorecard/charts were
 * removed; this surface is the table.)
 */
export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requireAuth();

  // Bare /campaigns (no params) lands on the caller's own default view, if set.
  if (Object.keys(params).length === 0) {
    const def = await getDefaultSummaryView(user.id, "campaigns");
    if (def && def.query.trim().length > 0) {
      redirect(`/campaigns?${def.query}`);
    }
  }

  const rawFrom = pickFirst(params.from);
  const rawTo = pickFirst(params.to);
  const parsed = portfolioFiltersSchema.parse({
    from: rawFrom,
    to: rawTo,
    platforms: pickFirst(params.platforms),
    objectives: pickFirst(params.objectives),
    statuses: pickFirst(params.statuses),
    q: pickFirst(params.q),
    includeExcluded: pickFirst(params.includeExcluded),
    sort: pickFirst(params.sort),
    dir: pickFirst(params.dir),
    hide: pickFirst(params.hide),
    order: pickFirst(params.order),
  });

  // Explicit URL range wins; otherwise the saved default; otherwise last-7.
  const range =
    rawFrom && rawTo
      ? { from: parsed.from, to: parsed.to }
      : ((await getPreferredRange()) ?? { from: parsed.from, to: parsed.to });
  const from = range.from;
  const to = range.to;

  const filters: PortfolioFilters = {
    from,
    to,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    objectives: parsed.objectives.length > 0 ? parsed.objectives : undefined,
    statuses: parsed.statuses.length > 0 ? parsed.statuses : undefined,
    q: parsed.q,
    includeExcluded: parsed.includeExcluded,
  };

  const [campaigns, views] = await Promise.all([
    portfolioCampaigns(filters),
    listSummaryViews(user.id, "campaigns"),
  ]);

  return (
    <PageShell>
      <PageHeader
        title="Campaigns"
        subtitle={
          <span className="num">
            {int(campaigns.length)} campaign
            {campaigns.length === 1 ? "" : "s"} · {from} → {to}
          </span>
        }
        rightSlot={
          <Button asChild>
            <Link href="/campaigns/new">
              <Plus className="w-4 h-4" /> New campaign
            </Link>
          </Button>
        }
      />

      <Suspense fallback={null}>
        <PortfolioFilterBar
          defaultFrom={from}
          defaultTo={to}
          views={views}
          currentUserId={user.id}
          isAdmin={user.role === "admin"}
        />
      </Suspense>

      <PortfolioTable
        rows={campaigns}
        sort={parsed.sort}
        dir={parsed.dir}
        hidden={parsed.hide}
        order={parsed.order}
      />
    </PageShell>
  );
}
