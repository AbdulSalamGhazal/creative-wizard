import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { defaultDateRange } from "@/db/queries/performance";
import { typeRollup } from "@/db/queries/trends";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { TypeRollupTable } from "@/components/trends/type-rollup-table";
import { dashboardFiltersSchema } from "@/validators/filters";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TRAILING_DAYS_DEFAULT = 30;

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function TrendsByTypePage({
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
    includeExcluded: pickFirst(params.includeExcluded),
  });
  const byPlatform = pickFirst(params.split) === "platform";

  const range = defaultDateRange(TRAILING_DAYS_DEFAULT);
  const from = parsed.from ?? range.from;
  const to = parsed.to ?? range.to;

  const [rows, products, tags] = await Promise.all([
    typeRollup(
      {
        from,
        to,
        platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
        productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
        includeExcluded: parsed.includeExcluded,
      },
      { byPlatform },
    ),
    listProducts(),
    listAllTags(),
  ]);

  // Preserve current filters on the blended/split toggle links.
  const base = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && v && k !== "split") base.set(k, v);
  }
  const blendedHref = base.toString()
    ? `/trends/by-type?${base.toString()}`
    : "/trends/by-type";
  const splitParams = new URLSearchParams(base);
  splitParams.set("split", "platform");
  const splitHref = `/trends/by-type?${splitParams.toString()}`;

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
          <Link
            href="/trends"
            className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink transition-colors mb-2"
          >
            <ArrowLeft className="w-3 h-3" />
            Trends
          </Link>
          <h1 className="font-display text-4xl tracking-tight">By type</h1>
          <p className="text-ink-2 text-sm mt-1">
            Performance rolled up by creative format — video, image, slides.
            Toggle the split to break each format down by platform. Click a row
            to open the matching Library view.
          </p>
        </div>
        <Badge variant="outline" className="text-ink-3">
          {from} → {to}
        </Badge>
      </div>

      {/* Blended / split-by-platform toggle */}
      <div className="inline-flex items-center rounded-md border border-line bg-surface p-0.5 text-xs">
        <Link
          href={blendedHref}
          scroll={false}
          className={cn(
            "px-3 h-7 inline-flex items-center rounded transition-colors",
            byPlatform ? "text-ink-2 hover:text-ink" : "bg-surface-3 text-ink",
          )}
        >
          By type
        </Link>
        <Link
          href={splitHref}
          scroll={false}
          className={cn(
            "px-3 h-7 inline-flex items-center rounded transition-colors",
            byPlatform ? "bg-surface-3 text-ink" : "text-ink-2 hover:text-ink",
          )}
        >
          Split by platform
        </Link>
      </div>

      <TypeRollupTable rows={rows} byPlatform={byPlatform} />
    </div>
  );
}
