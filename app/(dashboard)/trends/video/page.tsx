import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { defaultDateRange } from "@/lib/date-presets";
import { resolvePreferredRange } from "@/db/queries/user-prefs";
import { videoDiagnostics } from "@/db/queries/trends";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { VideoDiagnosticsTable } from "@/components/trends/video-diagnostics-table";
import { VideoRetention } from "@/components/trends/video-retention";
import { VideoScatter } from "@/components/trends/video-scatter";
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

  const range = await resolvePreferredRange(
    pickFirst(params.from),
    pickFirst(params.to),
    defaultDateRange(TRAILING_DAYS_DEFAULT),
  );
  const from = range.from;
  const to = range.to;

  const [
    { rows, aggregate, videoCount, medianHookRate, medianHoldRate, medianCompleteRate },
    products,
    tags,
  ] = await Promise.all([
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
          <FilterStrip
            products={products}
            tags={tags}
            hideType
            defaultFrom={from}
            defaultTo={to}
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
          <h1 className="font-display text-4xl tracking-tight">Video diagnostics</h1>
          <p className="text-ink-2 text-sm mt-1 max-w-2xl">
            Retention funnel: 2s → 25 → 50 → 75 → 100%. Video creatives only;
            rates below the portfolio median are flagged amber.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-ink-3">
            {from} → {to}
          </Badge>
        </div>
      </div>

      {videoCount > 0 && (
        <div className="flex items-center gap-6 text-sm">
          <Stat label="Median hook" value={pct(medianHookRate)} />
          <Stat label="Median hold (50%)" value={pct(medianHoldRate)} />
          <Stat label="Median complete" value={pct(medianCompleteRate)} />
          <div className="text-ink-3 text-xs">
            across {videoCount} video creative{videoCount === 1 ? "" : "s"}
          </div>
        </div>
      )}

      {/* Hero: the retention / completion curve */}
      <VideoRetention aggregate={aggregate} rows={rows} />

      {/* Flexible diagnostic scatter */}
      <VideoScatter rows={rows} />

      {/* Per-video funnel table */}
      <VideoDiagnosticsTable
        rows={rows}
        medianHookRate={medianHookRate}
        medianHoldRate={medianHoldRate}
        medianCompleteRate={medianCompleteRate}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-ink-3 text-xs uppercase tracking-[0.12em]">{label}</span>
      <div className="font-display text-2xl num text-ink leading-none mt-1">{value}</div>
    </div>
  );
}
