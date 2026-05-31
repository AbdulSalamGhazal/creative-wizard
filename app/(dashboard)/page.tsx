import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import {
  defaultDateRange,
  platformMix,
  type KpiFilters,
} from "@/db/queries/performance";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { OverviewSection } from "@/components/overview/overview-section";
import { FilterStrip } from "@/components/filters/filter-strip";
import { dashboardFiltersSchema } from "@/validators/filters";
import { PLATFORM_LABEL } from "@/lib/palette";

type Platform = "instagram" | "facebook" | "tiktok" | "snapchat" | "google";

const TRAILING_DAYS_DEFAULT = 30;

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function OverviewPage({
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
    statuses: pickFirst(params.statuses),
    tags: pickFirst(params.tags),
    includeExcluded: pickFirst(params.includeExcluded),
  });

  const defaultRange = defaultDateRange(TRAILING_DAYS_DEFAULT);
  const from = parsed.from ?? defaultRange.from;
  const to = parsed.to ?? defaultRange.to;

  const filters: KpiFilters = {
    from,
    to,
    productIds: parsed.productIds,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    types: parsed.types.length > 0 ? parsed.types : undefined,
    statuses: parsed.statuses.length > 0 ? parsed.statuses : undefined,
    tags: parsed.tags.length > 0 ? parsed.tags : undefined,
    includeExcluded: parsed.includeExcluded,
  };

  const platformsBadge =
    parsed.platforms.length > 0 ? parsed.platforms.join(", ") : "all platforms";
  const rangeLabel = `${from} → ${to}`;

  // Which platforms to break out: those with spend in the window (already
  // narrowed by any platform filter), ordered by spend desc. We only show
  // the per-platform sections when 2+ platforms are in scope — with one,
  // the breakout would just duplicate the blended section above.
  const [present, products, tags] = await Promise.all([
    platformMix(filters),
    listProducts(),
    listAllTags(),
  ]);
  const presentPlatforms = present.map((r) => r.platform as Platform);
  const showBreakouts = presentPlatforms.length >= 2;

  return (
    <div className="space-y-6">
      <Suspense
        fallback={
          <div className="-mx-6 px-6 h-12 border-b border-line bg-background/95 backdrop-blur" />
        }
      >
        <div className="-mx-6 -mt-6 mb-2">
          <FilterStrip products={products} tags={tags} />
        </div>
      </Suspense>

      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Overview</h1>
          <p className="text-ink-2 text-sm mt-1">
            Aggregated performance across products, platforms, and creatives.
          </p>
        </div>
        <Badge variant="outline" className="text-ink-3">
          {from} → {to} · {platformsBadge} ·{" "}
          {parsed.includeExcluded ? "excluded shown" : "excluded hidden"}
        </Badge>
      </div>

      <OverviewSection
        title="All platforms"
        filters={filters}
        rangeLabel={rangeLabel}
      />

      {showBreakouts && (
        <>
          <div className="flex items-center gap-3 pt-4">
            <span className="text-[11px] uppercase tracking-[0.18em] text-ink-3">
              By platform
            </span>
            <div className="h-px flex-1 bg-line" />
          </div>
          {presentPlatforms.map((p) => (
            <div key={p} className="border-t border-line pt-2">
              <OverviewSection
                title={PLATFORM_LABEL[p]}
                filters={filters}
                platform={p}
                rangeLabel={rangeLabel}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
