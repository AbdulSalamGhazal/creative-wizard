import { redirect } from "next/navigation";
import { int } from "@/lib/format";
import { listAllAngles } from "@/db/queries/creatives";
import { listProducts } from "@/db/queries/products";
import { listCreativeSummary } from "@/db/queries/summary";
import { getRatingConfig } from "@/db/queries/rating";
import {
  getDefaultSummaryView,
  listSummaryViews,
} from "@/db/queries/summary-views";
import { summaryFiltersSchema } from "@/validators/summary";
import { resolvePreferredRange, resolveIncludeExcluded } from "@/db/queries/user-prefs";
import { LIFETIME_FLOOR, presetLabel, todayIso } from "@/lib/date-presets";
import { platformEnum } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { SummaryFilterBar } from "@/components/summary/summary-filter-bar";
import { SummaryTable } from "@/components/summary/summary-table";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export const metadata = { title: "Ads" };

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
    angles: pickFirst(params.angles),
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

  // Three independent preference reads that used to await one after another,
  // each waiting on a result it never used. (`lib/db.ts` holds ONE connection,
  // so they still execute serially — the win is not stalling on unrelated
  // round-trips, and `getRatingConfig` is now cached per request.)
  //   · Excluded state: URL param wins, else the user's saved default.
  //   · Range: an explicit valid URL range wins; else the saved default; else
  //     all-time (Lifetime). RAW params (not the validator-defaulted
  //     parsed.from/to) so the saved preference isn't masked.
  //   · Rating config: feeds the Rate column and the rate sort/filter, so it
  //     has to be resolved before the summary query that consumes it.
  const [includeExcluded, range, ratingConfig] = await Promise.all([
    resolveIncludeExcluded(pickFirst(params.includeExcluded)),
    resolvePreferredRange(pickFirst(params.from), pickFirst(params.to), {
      from: LIFETIME_FLOOR,
      to: todayIso(),
    }),
    getRatingConfig(),
  ]);

  // Platform default: NO `platforms` param at all → all platforms (the default
  // landing view). An explicit `platforms=none` sentinel (the user deselected
  // every platform) parses to [] and shows nothing. A subset → just those.
  const effectivePlatforms =
    pickFirst(params.platforms) === undefined
      ? [...platformEnum]
      : parsed.platforms;

  // Filter dropdowns + the query run in parallel.
  const [
    { rows, platforms: selectedPlatforms, effectiveSort },
    products,
    angles,
    views,
  ] = await Promise.all([
    listCreativeSummary({
      from: range.from,
      to: range.to,
      q: parsed.q,
      productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
      platforms: effectivePlatforms.length > 0 ? effectivePlatforms : undefined,
      types: parsed.types.length > 0 ? parsed.types : undefined,
      angles: parsed.angles.length > 0 ? parsed.angles : undefined,
      creatorIds: parsed.creatorIds.length > 0 ? parsed.creatorIds : undefined,
      includeExcluded,
      sort: parsed.sort,
      dir: parsed.dir,
      metricFilters:
        parsed.metricFilters.length > 0 ? parsed.metricFilters : undefined,
      rateFilter: parsed.rate,
      statusFilter: parsed.status,
      ratingConfig,
    }),
    listProducts(),
    listAllAngles(),
    listSummaryViews(user.id, "summary"),
  ]);

  // Reconstruct the base URLSearchParams for sort-link href computation.
  const baseParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && v) baseParams.set(k, v);
  }

  const rangeLabel = presetLabel(range.from, range.to);
  const platformsLabel =
    selectedPlatforms.length === 0
      ? "no platforms selected"
      : selectedPlatforms.length === platformEnum.length
        ? "all platforms"
        : selectedPlatforms.join(", ");

  return (
    <PageShell>
      <SummaryFilterBar
          includeExcludedDefault={includeExcluded}
        products={products}
        angles={angles}
        effectivePlatforms={selectedPlatforms}
        views={views}
        currentUserId={user.id}
        isAdmin={user.role === "admin"}
        defaultFrom={range.from}
        defaultTo={range.to}
      />

      <PageHeader
        title="Ads"
        subtitle={
          <>
            {int(rows.length)} creative{rows.length === 1 ? "" : "s"}
            {" · "}
            {rangeLabel}
            {" · "}
            {platformsLabel}
          </>
        }
        rightSlot={
          <div className="text-[11px] text-ink-3 font-mono">
            Sorted by {effectiveSort.key} {effectiveSort.dir}
          </div>
        }
      />

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
    </PageShell>
  );
}
