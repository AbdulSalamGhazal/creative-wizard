import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { launchFatigue, type LaunchFatigueFilters } from "@/db/queries/performance";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import {
  LaunchFatigue,
  type LaunchFatigueViewRow,
} from "@/components/trends/launch-fatigue";
import { assessFatigue, FATIGUE_TIER_ORDER } from "@/lib/launch-fatigue";
import { dashboardFiltersSchema } from "@/validators/filters";
import { LIFETIME_FLOOR, presetLabel, todayIso } from "@/lib/date-presets";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

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

  const count = (t: string) =>
    rows.filter((r) => r.assessment.tier === t).length;
  const summaryParts = [
    count("fatigued") > 0 && `${count("fatigued")} fatigued`,
    count("holding") > 0 && `${count("holding")} holding`,
    count("improving") > 0 && `${count("improving")} improving`,
    count("new") > 0 && `${count("new")} too new`,
    count("low") > 0 && `${count("low")} low spend`,
  ].filter(Boolean);

  const cohortLabel = cohort.launchedFrom
    ? presetLabel(cohort.launchedFrom, cohort.launchedTo!)
    : "all launches";

  return (
    <div className="space-y-6">
      <Suspense
        fallback={<div className="-mx-6 px-6 h-12 border-b border-line bg-background/95" />}
      >
        <div className="-mx-6 -mt-6 mb-2">
          <FilterStrip
            products={products}
            tags={tags}
            defaultFrom={LIFETIME_FLOOR}
            defaultTo={todayIso()}
            rememberDate={false}
          />
        </div>
      </Suspense>

      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/trends"
            className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink transition-colors mb-2"
          >
            <ArrowLeft className="w-3 h-3" />
            Trends
          </Link>
          <h1 className="font-display text-4xl tracking-tight">Launches</h1>
          <p className="text-ink-2 text-sm mt-1 max-w-2xl">
            Creative fatigue — each creative&rsquo;s ROAS across three windows
            anchored to its own launch: days 1&ndash;7, 8&ndash;30, 31&ndash;90.
            Fatigued = ROAS fell ≥30% by the latest window. The date filter picks
            the launch cohort; tiny spenders are muted.
          </p>
        </div>
        <Badge variant="outline" className="text-ink-3">
          {rows.length} launch{rows.length === 1 ? "" : "es"} · {cohortLabel}
        </Badge>
      </div>

      {summaryParts.length > 0 && (
        <div className="text-[11px] text-ink-3">{summaryParts.join(" · ")}</div>
      )}

      <LaunchFatigue rows={rows} />
    </div>
  );
}
