import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { defaultDateRange } from "@/db/queries/performance";
import { videoDiagnostics } from "@/db/queries/trends";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { VideoDiagnosticsTable } from "@/components/trends/video-diagnostics-table";
import { dashboardFiltersSchema } from "@/validators/filters";
import { pct } from "@/lib/format";

export const dynamic = "force-dynamic";

const TRAILING_DAYS_DEFAULT = 30;

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function TrendsVideoPage({
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

  const range = defaultDateRange(TRAILING_DAYS_DEFAULT);
  const from = parsed.from ?? range.from;
  const to = parsed.to ?? range.to;

  const [{ rows, medianHookRate, medianHoldRate }, products, tags] =
    await Promise.all([
      videoDiagnostics({
        from,
        to,
        platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
        productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
        includeExcluded: parsed.includeExcluded,
      }),
      listProducts(),
      listAllTags(),
    ]);

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
          <h1 className="font-display text-4xl tracking-tight">Video diagnostics</h1>
          <p className="text-ink-2 text-sm mt-1">
            Hook rate (2s views ÷ impressions) and hold rate (50% ÷ 2s) — the
            early signals that decide whether a video lives. Rates below the
            portfolio median are flagged amber.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-ink-3">
            {from} → {to}
          </Badge>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="flex items-center gap-6 text-sm">
          <div>
            <span className="text-ink-3 text-xs uppercase tracking-[0.12em]">
              Median hook
            </span>
            <div className="font-display text-2xl num text-ink leading-none mt-1">
              {pct(medianHookRate)}
            </div>
          </div>
          <div>
            <span className="text-ink-3 text-xs uppercase tracking-[0.12em]">
              Median hold
            </span>
            <div className="font-display text-2xl num text-ink leading-none mt-1">
              {pct(medianHoldRate)}
            </div>
          </div>
          <div className="text-ink-3 text-xs">
            across {rows.length} video creative{rows.length === 1 ? "" : "s"}
          </div>
        </div>
      )}

      <VideoDiagnosticsTable
        rows={rows}
        medianHookRate={medianHookRate}
        medianHoldRate={medianHoldRate}
      />
    </div>
  );
}
