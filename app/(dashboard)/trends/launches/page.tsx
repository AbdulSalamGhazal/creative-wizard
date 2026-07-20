import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { launchFatigue, type LaunchFatigueFilters } from "@/db/queries/performance";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import {
  LaunchFatigueSummary,
  LaunchFatigueTable,
  type LaunchFatigueViewRow,
} from "@/components/trends/launch-fatigue";
import {
  assessFatigue,
  FATIGUE_TIER_ORDER,
  type FatigueTier,
  type FatigueWindowSums,
} from "@/lib/launch-fatigue";
import { dashboardFiltersSchema } from "@/validators/filters";
import { LIFETIME_FLOOR, presetLabel, todayIso } from "@/lib/date-presets";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const metadata = { title: "Trends · Launches" };

export default async function TrendsLaunchesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const parsed = dashboardFiltersSchema.parse({
    from: pickFirst(params.from),
    to: pickFirst(params.to),
    productIds: pickFirst(params.productIds),
    platforms: pickFirst(params.platforms),
    types: pickFirst(params.types),
    tags: pickFirst(params.tags),
    includeExcluded: pickFirst(params.includeExcluded),
  });

  // The date filter here is a LAUNCH cohort (which creatives launched in the
  // window), not a performance window — only apply it when both ends are real.
  const rawFrom = pickFirst(params.from);
  const rawTo = pickFirst(params.to);
  const cohort =
    rawFrom && rawTo && ISO.test(rawFrom) && ISO.test(rawTo) && rawFrom <= rawTo
      ? { launchedFrom: rawFrom, launchedTo: rawTo }
      : {};

  const filters: LaunchFatigueFilters = {
    ...cohort,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
    types: parsed.types.length > 0 ? parsed.types : undefined,
    tags: parsed.tags.length > 0 ? parsed.tags : undefined,
    includeExcluded: parsed.includeExcluded,
  };

  const [raw, products, tags] = await Promise.all([
    launchFatigue(filters),
    listProducts(),
    listAllTags(),
  ]);

  const rows: LaunchFatigueViewRow[] = raw
    .map((r) => ({
      creativeId: r.creativeId,
      name: r.name,
      productName: r.productName,
      type: r.type,
      launchDate: r.launchDate,
      derived: r.derived,
      daysSinceLaunch: r.daysSinceLaunch,
      href: `/creatives/${encodeURIComponent(r.name)}`,
      assessment: assessFatigue(r.w1, r.w2, r.w3),
    }))
    .sort((a, b) => {
      const t =
        FATIGUE_TIER_ORDER[a.assessment.tier] -
        FATIGUE_TIER_ORDER[b.assessment.tier];
      if (t !== 0) return t;
      // Within fatigued, biggest drop first; otherwise newest launch first.
      if (a.assessment.tier === "fatigued" && b.assessment.tier === "fatigued") {
        return (b.assessment.drop ?? 0) - (a.assessment.drop ?? 0);
      }
      return b.launchDate.localeCompare(a.launchDate);
    });

  // Portfolio summary across every launch in view: blended window sums →
  // assessment, plus the verdict tally.
  const counts: Record<FatigueTier, number> = {
    fatigued: 0,
    improving: 0,
    holding: 0,
    new: 0,
    low: 0,
  };
  for (const r of rows) counts[r.assessment.tier] += 1;

  const zero = (): FatigueWindowSums => ({
    spend: 0,
    conversionValue: 0,
    clicks: 0,
    impressions: 0,
    conversions: 0,
    landingPageViews: 0,
  });
  const port = { w1: zero(), w2: zero(), w3: zero() };
  for (const r of raw) {
    for (const k of ["w1", "w2", "w3"] as const) {
      port[k].spend += r[k].spend;
      port[k].conversionValue += r[k].conversionValue;
      port[k].clicks += r[k].clicks;
      port[k].impressions += r[k].impressions;
      port[k].conversions += r[k].conversions;
      port[k].landingPageViews += r[k].landingPageViews;
    }
  }
  const portfolio = assessFatigue(port.w1, port.w2, port.w3);
  const totalSpend = port.w1.spend + port.w2.spend + port.w3.spend;
  const estimatedCount = rows.filter((r) => r.derived).length;

  const cohortLabel = cohort.launchedFrom
    ? presetLabel(cohort.launchedFrom, cohort.launchedTo!)
    : "all launches";

  return (
    <PageShell
      filterStrip={
        <FilterStrip
          products={products}
          tags={tags}
          defaultFrom={LIFETIME_FLOOR}
          defaultTo={todayIso()}
          rememberDate={false}
        />
      }
    >
      <PageHeader
        backLink={{ href: "/trends", label: "Trends" }}
        title="Launches"
        subtitle={
          <>
            ROAS across three windows from each creative&rsquo;s launch: days
            1&ndash;7, 8&ndash;30, 31&ndash;90. Fatigued = ROAS fell ≥30% by the
            latest window. Tiny spenders are muted.
          </>
        }
        rightSlot={
          <Badge variant="outline" className="text-ink-3">
            {rows.length} launch{rows.length === 1 ? "" : "es"} · {cohortLabel}
          </Badge>
        }
      />

      {rows.length > 0 && (
        <LaunchFatigueSummary
          count={rows.length}
          totalSpend={totalSpend}
          estimatedCount={estimatedCount}
          counts={counts}
          w1={portfolio.w1}
          w2={portfolio.w2}
          w3={portfolio.w3}
          drop={portfolio.drop}
        />
      )}

      <LaunchFatigueTable rows={rows} />
    </PageShell>
  );
}
