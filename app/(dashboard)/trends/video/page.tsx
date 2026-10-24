import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { defaultDateRange } from "@/lib/date-presets";
import {
  resolveIncludeExcluded,
  resolvePreferredRange,
  resolveStripFilters,
} from "@/db/queries/user-prefs";
import { videoDiagnostics } from "@/db/queries/trends";
import { listProducts } from "@/db/queries/products";
import { listAllAngles } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { VideoDiagnosticsTable } from "@/components/trends/video-diagnostics-table";
import { VideoRetention } from "@/components/trends/video-retention";
import { VideoScatter } from "@/components/trends/video-scatter";
import { dashboardFiltersSchema } from "@/validators/filters";
import { pct } from "@/lib/format";
import { pickFirst } from "@/lib/url";
import { PLATFORMS_WITH_CREATIVES } from "@/lib/palette";

export const dynamic = "force-dynamic";

const TRAILING_DAYS_DEFAULT = 30;

type SearchParams = Record<string, string | string[] | undefined>;
export const metadata = { title: "Trends · Video" };

export default async function TrendsVideoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [products, angles] = await Promise.all([listProducts(), listAllAngles()]);
  // Remembered filters (D20): only the ones this page's queries apply.
  const applies = ["platforms", "productIds"] as const;
  const resolved = await resolveStripFilters(params, {
    keys: applies,
    platforms: PLATFORMS_WITH_CREATIVES,
    productIds: products.map((p) => p.id),
    angles,
  });
  const parsed = dashboardFiltersSchema.parse({
    from: pickFirst(params.from),
    to: pickFirst(params.to),
    productIds: resolved.productIds,
    platforms: resolved.platforms,
    includeExcluded: pickFirst(params.includeExcluded),
  });

  // Effective Excluded state: URL param wins, else the user's saved default.
  const includeExcluded = await resolveIncludeExcluded(
    pickFirst(params.includeExcluded),
  );

  const range = await resolvePreferredRange(
    pickFirst(params.from),
    pickFirst(params.to),
    defaultDateRange(TRAILING_DAYS_DEFAULT),
  );
  const from = range.from;
  const to = range.to;

  const { rows, aggregate, videoCount, medianHookRate, medianHoldRate, medianCompleteRate } =
    await videoDiagnostics({
      from,
      to,
      platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
      productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
      includeExcluded,
    });

  return (
    <PageShell
      filterStrip={
        <FilterStrip
          includeExcludedDefault={includeExcluded}
          products={products}
          angles={angles}
          hideType
          defaultFrom={from}
          defaultTo={to}
          platformScope="creative"
          applies={applies}
          resolvedFilters={resolved}
        />
      }
    >
      <PageHeader
        eyebrow="Trends"
        title="Video"
        info="Video creatives only; rates below the portfolio median are flagged amber."
        rightSlot={
          <Badge variant="outline" className="text-ink-3">
            {from} → {to}
          </Badge>
        }
      />

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
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-ink-3 text-label">{label}</span>
      <div className="font-display text-2xl num text-ink leading-none mt-1">{value}</div>
    </div>
  );
}
