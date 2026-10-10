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
import {
  resolveFilterPrefs,
  resolvePreferredRange,
  resolveIncludeExcluded,
} from "@/db/queries/user-prefs";
import { VIEW_MARKER_PARAM, isSavedViewApplied } from "@/validators/user-prefs";
import { TABLE_KEYS, resolveColumnPrefs } from "@/lib/table-columns";
import { resolveTablePrefs } from "@/db/queries/user-prefs";
// Plain modules, never the `"use client"` table: a server component may import
// a client COMPONENT, never a VALUE out of a client module.
import {
  ADS_HIDEABLE_KEYS,
  ADS_TOTAL_KEY,
  joinAdsHidden,
  splitAdsHidden,
} from "@/components/summary/summary-columns";
import { LIFETIME_FLOOR, presetLabel, todayIso } from "@/lib/date-presets";
import { PLATFORMS_WITH_CREATIVES } from "@/lib/palette";
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
      // The view marker says "a saved view owns this state" — the remembered
      // filters below then no-op (it's transient, so it never lands in a view).
      redirect(`/summary?${def.query}&${VIEW_MARKER_PARAM}=${def.id}`);
    }
  }

  // The dropdown sources double as the pref resolver's vocabulary: a
  // remembered product that was since deleted must be dropped, not queried.
  const [products, angles] = await Promise.all([listProducts(), listAllAngles()]);

  // REMEMBERED FILTERS (migration 0049): URL wins, else this user's saved
  // value for this brand, else the page default — the date range's rule,
  // generalized. Suppressed while a saved view is applied, or once the URL
  // states its filters in full (`resolveFilterPrefs` checks both).
  const pref = await resolveFilterPrefs(
    [
      { key: "platforms" },
      { key: "status" },
      { key: "productIds", allow: products.map((p) => p.id) },
      { key: "types" },
      { key: "angles", allow: angles },
      { key: "priorities" },
      { key: "stages" },
      { key: "rate" },
    ],
    (key: string) => pickFirst(params[key]),
  );

  const parsed = summaryFiltersSchema.parse({
    from: pickFirst(params.from),
    to: pickFirst(params.to),
    q: pickFirst(params.q),
    productIds: pref.productIds,
    platforms: pref.platforms,
    types: pref.types,
    angles: pref.angles,
    priorities: pref.priorities,
    stages: pref.stages,
    creatorIds: pickFirst(params.creatorIds),
    includeExcluded: pickFirst(params.includeExcluded),
    sort: pickFirst(params.sort),
    dir: pickFirst(params.dir),
    hideIdentity: pickFirst(params.hideIdentity),
    hideMetrics: pickFirst(params.hideMetrics),
    hideRate: pickFirst(params.hideRate),
    hideBlended: pickFirst(params.hideBlended),
    metricFilters: pickFirst(params.metricFilters),
    rate: pref.rate,
    status: pref.status,
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

  // Platform default: NO `platforms` param at all → every platform that HAS
  // creatives (the default landing view; google has no creative concept, so it
  // has no column group here — see PLATFORMS_WITH_CREATIVES). An explicit
  // `platforms=none` sentinel (the user deselected every platform) parses to []
  // and shows nothing. A subset → just those (the query drops google again).
  const effectivePlatforms =
    pref.platforms === undefined
      ? [...PLATFORMS_WITH_CREATIVES]
      : parsed.platforms;

  // Filter dropdowns + the query run in parallel.
  const [{ rows, platforms: selectedPlatforms, effectiveSort }, views] = await Promise.all([
    listCreativeSummary({
      from: range.from,
      to: range.to,
      q: parsed.q,
      productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
      platforms: effectivePlatforms.length > 0 ? effectivePlatforms : undefined,
      types: parsed.types.length > 0 ? parsed.types : undefined,
      angles: parsed.angles.length > 0 ? parsed.angles : undefined,
      priorities: parsed.priorities.length > 0 ? parsed.priorities : undefined,
      stages: parsed.stages.length > 0 ? parsed.stages : undefined,
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
      : selectedPlatforms.length === PLATFORMS_WITH_CREATIVES.length
        ? "all platforms"
        : selectedPlatforms.join(", ");

  // COLUMNS: URL → applied saved view → this user's preference → the config.
  // The URL keeps its four params untouched (every saved view is a stored
  // query string); `splitAdsHidden`/`joinAdsHidden` translate them to and from
  // the one flat list the columns system speaks.
  const adsPrefs = await resolveTablePrefs([TABLE_KEYS.ADS_SUMMARY]);
  const columnState = resolveColumnPrefs({
    url: {
      hidden: joinAdsHidden({
        identity: parsed.hideIdentity,
        metrics: parsed.hideMetrics,
        rate: parsed.hideRate,
        blended: parsed.hideBlended,
      }),
      // Group order has no URL param — it is preference-only.
      order: [],
    },
    viewApplied: isSavedViewApplied((key: string) => pickFirst(params[key])),
    pref: adsPrefs[TABLE_KEYS.ADS_SUMMARY],
    hideable: ADS_HIDEABLE_KEYS,
    // The ORDER universe is the platform groups (plus the blended total),
    // which is what the control reorders.
    defaults: [...selectedPlatforms, ADS_TOTAL_KEY],
  });
  const columns = splitAdsHidden(columnState.hidden);

  return (
    <PageShell>
      <SummaryFilterBar
        resolvedFilters={pref}
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
        hiddenIdentity={new Set(columns.identity)}
        hiddenMetrics={new Set(columns.metrics)}
        columnOrder={columnState.order}
        ratingConfig={ratingConfig}
        showRate={!columns.rate}
        showBlended={!columns.blended}
      />
    </PageShell>
  );
}
