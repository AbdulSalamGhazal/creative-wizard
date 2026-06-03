import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { listCampaigns, type CampaignFilters } from "@/db/queries/campaign";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { CampaignTable } from "@/components/campaign/campaign-table";
import { dashboardFiltersSchema } from "@/validators/filters";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function CampaignsPage({
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

  const filters: CampaignFilters = {
    from: parsed.from,
    to: parsed.to,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
    types: parsed.types.length > 0 ? parsed.types : undefined,
    statuses: parsed.statuses.length > 0 ? parsed.statuses : undefined,
    tags: parsed.tags.length > 0 ? parsed.tags : undefined,
    includeExcluded: parsed.includeExcluded,
  };

  const [campaigns, products, tags] = await Promise.all([
    listCampaigns(filters),
    listProducts(),
    listAllTags(),
  ]);

  const rangeLabel =
    parsed.from && parsed.to ? `${parsed.from} → ${parsed.to}` : "All-time";

  return (
    <div className="space-y-6">
      <Suspense
        fallback={<div className="-mx-6 px-6 h-12 border-b border-line bg-background/95" />}
      >
        <div className="-mx-6 -mt-6 mb-2">
          <FilterStrip products={products} tags={tags} />
        </div>
      </Suspense>

      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
            Campaigns
          </div>
          <h1 className="font-display text-4xl tracking-tight">Campaigns</h1>
          <p className="text-ink-2 text-sm mt-1">
            Every campaign (full name incl. adset / platform), by spend. Open one
            for the complete breakdown — funnel, over-time, platforms, creatives.
          </p>
        </div>
        <Badge variant="outline" className="text-ink-3">
          {rangeLabel} · {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <CampaignTable rows={campaigns} />
    </div>
  );
}
