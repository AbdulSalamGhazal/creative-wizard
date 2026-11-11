import {
  kpis,
  compareDimensions,
  compareSideSeries,
  type CompareMetric,
  type KpiFilters,
} from "@/db/queries/performance";
import { CompareControls } from "@/components/compare/compare-controls";
import {
  AddMetricBlock,
  MetricBlockHeader,
} from "@/components/compare/metric-blocks";
import { CompareChart } from "@/components/charts/compare-chart";
import { CompareTotalsTable } from "@/components/compare/compare-totals-table";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { resolveIncludeExcluded, resolvePreferredRange } from "@/db/queries/user-prefs";
import {
  compareFiltersSchema,
  sideIsEmpty,
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
    campaignNames: side.campaigns.length ? side.campaigns : undefined,
    creativeIds: side.creatives.length ? side.creatives : undefined,
    includeExcluded,
    ...range,
  };
}

function sideSummary(side: CompareSide): string {
  const parts: string[] = [];
  if (side.platforms.length) parts.push(`${side.platforms.length} platform(s)`);
  if (side.campaigns.length) parts.push(`${side.campaigns.length} campaign(s)`);
  if (side.creatives.length) parts.push(`${side.creatives.length} creative(s)`);
  const sel = sideIsEmpty(side) ? "All data" : parts.join(" · ");
  // Surface a side-specific window so the totals row says what it covers.
  return side.from && side.to ? `${sel} · ${side.from} → ${side.to}` : sel;
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
    aCampaigns: pickFirst(params.aCampaigns),
    aCreatives: pickFirst(params.aCreatives),
    aFrom: pickFirst(params.aFrom),
    aTo: pickFirst(params.aTo),
    bPlatforms: pickFirst(params.bPlatforms),
    bCampaigns: pickFirst(params.bCampaigns),
    bCreatives: pickFirst(params.bCreatives),
    bFrom: pickFirst(params.bFrom),
    bTo: pickFirst(params.bTo),
    cPlatforms: pickFirst(params.cPlatforms),
    cCampaigns: pickFirst(params.cCampaigns),
    cCreatives: pickFirst(params.cCreatives),
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
          header={<MetricBlockHeader metric={metric} metrics={parsed.metrics} />}
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
              selection: sideSummary(s),
              totals: totals[i]!,
            }))}
          />
        </AdDataGate>
      </section>
    </PageShell>
  );
}
