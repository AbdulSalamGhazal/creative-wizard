import {
  kpis,
  compareDimensions,
  compareSideSeries,
  type CompareDimensionRow,
  type CompareMetric,
  type KpiFilters,
} from "@/db/queries/performance";
import { CompareControls } from "@/components/compare/compare-controls";
import {
  AddMetricBlock,
  MetricBlockHeader,
} from "@/components/compare/metric-blocks";
import { CompareChart } from "@/components/charts/compare-chart";
import {
  CompareTotalsTable,
  type CompareSelectionPart,
} from "@/components/compare/compare-totals-table";
import { adSetPath, campaignPath } from "@/lib/campaign";
import { withDateRange } from "@/lib/url";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { resolveIncludeExcluded, resolvePreferredRange } from "@/db/queries/user-prefs";
import {
  compareFiltersSchema,
  sideIsEmpty,
  sideLandingFilter,
  type CompareSide,
} from "@/validators/compare";
import { pickFirst } from "@/lib/url";
import { AdDataGate } from "@/components/ui/no-ad-data-state";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
/** Map a Compare side's selections onto the shared KpiFilters shape. */
function sideFilter(
  side: CompareSide,
  range: { from: string; to: string },
  includeExcluded: boolean,
): KpiFilters {
  return {
    platforms: side.platforms.length ? side.platforms : undefined,
    parentCampaignIds: side.parents.length ? side.parents : undefined,
    campaignNames: side.campaigns.length ? side.campaigns : undefined,
    creativeIds: side.creatives.length ? side.creatives : undefined,
    ...sideLandingFilter(side.landingPages),
    includeExcluded,
    ...range,
  };
}

/**
 * What a side covers, as the totals row says it: a count per level — except
 * ONE campaign or ONE ad set, which is named and links to its own page on the
 * side's window (2026-11). A campaign id that is no longer an option (deleted,
 * or on a platform Compare doesn't cover) stays a count: there is no page to
 * send anyone to.
 */
function sideSummary(
  side: CompareSide,
  range: { from: string; to: string },
  dimensions: ReadonlyArray<CompareDimensionRow>,
): CompareSelectionPart[] {
  const parts: CompareSelectionPart[] = [];
  if (side.platforms.length) parts.push({ text: `${side.platforms.length} platform(s)` });
  if (side.parents.length === 1) {
    const d = dimensions.find((x) => x.parentId === side.parents[0]);
    parts.push(
      d?.parentName && d.parentNetwork
        ? {
            text: d.parentName,
            href: withDateRange(campaignPath(d.parentNetwork, d.parentName), range.from, range.to),
          }
        : { text: "1 campaign(s)" },
    );
  } else if (side.parents.length) {
    parts.push({ text: `${side.parents.length} campaign(s)` });
  }
  if (side.campaigns.length === 1) {
    const name = side.campaigns[0]!;
    parts.push(
      dimensions.some((x) => x.campaign === name)
        ? { text: name, href: withDateRange(adSetPath(name), range.from, range.to) }
        : { text: "1 ad set(s)" },
    );
  } else if (side.campaigns.length) {
    parts.push({ text: `${side.campaigns.length} ad set(s)` });
  }
  if (side.creatives.length) parts.push({ text: `${side.creatives.length} creative(s)` });
  if (side.landingPages.length)
    parts.push({ text: `${side.landingPages.length} landing page(s)` });
  if (sideIsEmpty(side)) parts.push({ text: "All data" });
  // Surface a side-specific window so the totals row says what it covers.
  if (side.from && side.to) parts.push({ text: `${side.from} → ${side.to}` });
  return parts;
}

export const metadata = { title: "Analyzers · Compare" };

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const parsed = compareFiltersSchema.parse({
    aPlatforms: pickFirst(params.aPlatforms),
    aParents: pickFirst(params.aParents),
    aCampaigns: pickFirst(params.aCampaigns),
    aCreatives: pickFirst(params.aCreatives),
    aLandingPages: pickFirst(params.aLandingPages),
    aFrom: pickFirst(params.aFrom),
    aTo: pickFirst(params.aTo),
    bPlatforms: pickFirst(params.bPlatforms),
    bParents: pickFirst(params.bParents),
    bCampaigns: pickFirst(params.bCampaigns),
    bCreatives: pickFirst(params.bCreatives),
    bLandingPages: pickFirst(params.bLandingPages),
    bFrom: pickFirst(params.bFrom),
    bTo: pickFirst(params.bTo),
    cPlatforms: pickFirst(params.cPlatforms),
    cParents: pickFirst(params.cParents),
    cCampaigns: pickFirst(params.cCampaigns),
    cCreatives: pickFirst(params.cCreatives),
    cLandingPages: pickFirst(params.cLandingPages),
    cFrom: pickFirst(params.cFrom),
    cTo: pickFirst(params.cTo),
    sides: pickFirst(params.sides),
    metrics: pickFirst(params.metrics),
    from: pickFirst(params.from),
    to: pickFirst(params.to),
  });

  const dimensions = await compareDimensions();

  // Effective Excluded state: URL param wins, else the user's saved default.
  const includeExcluded = await resolveIncludeExcluded(
    pickFirst(params.includeExcluded),
  );

  // Each side runs over its own window when set, else the shared one — which
  // resolves like every other range page (R-067): URL → the user's saved
  // range → last 7 days. RAW params, never the validator's defaulted output,
  // or the saved range could never apply.
  const urlFrom = pickFirst(params.from) ?? null;
  const urlTo = pickFirst(params.to) ?? null;
  const sharedRange = await resolvePreferredRange(urlFrom, urlTo, {
    from: parsed.from,
    to: parsed.to,
  });
  const effRange = (s: CompareSide) =>
    s.from && s.to ? { from: s.from, to: s.to } : sharedRange;
  const sideFilters = parsed.sides.map((s) =>
    sideFilter(s, effRange(s), includeExcluded),
  );

  const totals = await Promise.all(sideFilters.map((f) => kpis(f)));

  // ONE daily scan per side carries every metric block's column; each block
  // then gets one series per side, tagged with the side id so the chart draws
  // one line each ("A" / "B" / "C").
  const seriesBySide = await Promise.all(
    sideFilters.map((f) => compareSideSeries({ ...f, metrics: parsed.metrics })),
  );
  const seriesByMetric = parsed.metrics.map((m: CompareMetric) =>
    seriesBySide.flatMap((bySide, i) =>
      (bySide.get(m) ?? []).map((p) => ({
        creativeId: parsed.sides[i]!.key.toUpperCase(),
        date: p.date,
        value: p.value,
      })),
    ),
  );

  const chartSides = parsed.sides.map((s) => ({
    id: s.key.toUpperCase(),
    name: s.label,
  }));

  // Windows differ → plot day-aligned (D1, D2, …) instead of by calendar date,
  // so a May week can overlay a June week. Same windows → calendar axis.
  const ranges = parsed.sides.map((s) => effRange(s));
  const sameWindow = ranges.every(
    (r) => r.from === ranges[0]!.from && r.to === ranges[0]!.to,
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Analyzers"
        title="Compare"
        info={
          <>
            Blended figures are true weighted averages. When windows differ,
            charts align by day (D1 = each side&rsquo;s first day with data).
          </>
        }
      />

      <CompareControls
        dimensions={dimensions}
        sides={parsed.sides}
        from={urlFrom}
        to={urlTo}
        range={sharedRange}
        includeExcluded={includeExcluded}
      />

      {/* One chart block per metric — the chart owns its card (ChartShell),
          with Smooth / Expand / click-to-hide-side legend. */}
      {parsed.metrics.map((metric, i) => (
        <CompareChart
          key={metric}
          rows={seriesByMetric[i] ?? []}
          creatives={chartSides}
          metric={metric}
          align={!sameWindow}
          // Keyed though it's a prop, not a list child: an element made inside
          // a server-side .map() reaches the client marked as a list item, and
          // React warns when ChartHeader renders it unkeyed.
          header={<MetricBlockHeader key={metric} metric={metric} metrics={parsed.metrics} />}
        />
      ))}

      <AddMetricBlock metrics={parsed.metrics} />

      {/* Side totals */}
      {/* A heading above the table, no Card around it (R-075): the table's
          own frame is the card, as everywhere else. */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-ink">
          {sameWindow
            ? "Totals in window"
            : "Totals — each side over its own window"}
        </h2>
        <AdDataGate>
          <CompareTotalsTable
            sides={parsed.sides.map((s, i) => ({
              label: s.label,
              selection: sideSummary(s, effRange(s), dimensions),
              totals: totals[i]!,
            }))}
          />
        </AdDataGate>
      </section>
    </PageShell>
  );
}
