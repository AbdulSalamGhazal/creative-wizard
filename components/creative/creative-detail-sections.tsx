import { DollarSign, Target, Banknote, Receipt, TrendingUp } from "lucide-react";
import {
  campaignMix,
  creativeDailyMetrics,
  kpisWithDelta,
  platformMix,
} from "@/db/queries/performance";
import {
  creativeDeletionSummary,
  creativeRecords,
  listCreativeSequence,
  type CreativeListFilters,
} from "@/db/queries/creatives";
import {
  creativePlatformFirstDays,
  earliestOf,
  latestOf,
  platformHorizons,
  resolveEntityBounds,
  resolvePlatformBounds,
} from "@/db/queries/series-bounds";
import { listAuditEvents } from "@/db/queries/audit";
import { CreativeDetailNav } from "@/components/creative/creative-detail-nav";
import { DeleteCreativeDialog } from "@/components/creative/delete-creative-dialog";
import { CreativePerfLineChart } from "@/components/charts/creative-perf-line";
import { CreativeCampaignsTable } from "@/components/creative/creative-campaigns-table";
import { CreativeRecordsTable } from "@/components/creative/creative-records-table";
import { AuditFeed } from "@/components/audit/audit-feed";
import { MetricCard } from "@/components/overview/metric-card";
import { int, roas, usd, usd0 } from "@/lib/format";
import { computeDelta } from "@/lib/period";

/**
 * Creative detail's STREAMED sections (D11, 2026-10). The page renders the
 * editable header as soon as the creative and its status are in; each of
 * these is an async server component inside its own `<Suspense>`, so the
 * pager, the analytics and the records/activity arrive as their queries
 * finish instead of the whole page waiting on its slowest one. Each has a
 * same-shape skeleton in `creative-detail-skeletons.tsx`.
 */

type Range = { from: string; to: string };

/** Prev / next over the Library's sequence for the filters in the URL. */
export async function CreativePager({
  name,
  filters,
  navQuery,
  backHref,
}: {
  name: string;
  filters: CreativeListFilters;
  /** The query string every detail link carries (list context + range). */
  navQuery: string;
  backHref: string;
}) {
  const seqNames = await listCreativeSequence(filters);
  const idx = seqNames.indexOf(name);
  const detailHref = (nm: string) =>
    `/library/${encodeURIComponent(nm)}${navQuery ? `?${navQuery}` : ""}`;
  const prevName = idx > 0 ? (seqNames[idx - 1] ?? null) : null;
  const nextName = idx >= 0 && idx < seqNames.length - 1 ? (seqNames[idx + 1] ?? null) : null;
  return (
    <CreativeDetailNav
      position={idx >= 0 ? idx + 1 : null}
      total={seqNames.length}
      prevHref={prevName ? detailHref(prevName) : null}
      nextHref={nextName ? detailHref(nextName) : null}
      backHref={backHref}
    />
  );
}

/**
 * Inside the Analytics card: the headline tiles (the Dashboard's five, with
 * period-over-period deltas, total-only), the over-time chart and the
 * campaigns table.
 */
export async function CreativeAnalyticsBody({
  creativeId,
  range,
  includeExcluded,
}: {
  creativeId: string;
  range: Range;
  includeExcluded: boolean;
}) {
  // Edge-fill bounds. Per-platform lines trail to each platform's own horizon
  // (a paused channel shows its pause); the grouped total trails to the
  // account data horizon and leads from the creative's first-ever day — both
  // derived from the per-platform reads (W2-4).
  const [pHorizons, pFirstDays] = await Promise.all([
    platformHorizons(),
    creativePlatformFirstDays(creativeId),
  ]);
  const platformEdges = resolvePlatformBounds({
    from: range.from,
    to: range.to,
    firstDays: pFirstDays,
    horizons: pHorizons,
  });
  const groupBounds = resolveEntityBounds({
    from: range.from,
    to: range.to,
    firstEver: earliestOf(pFirstDays),
    horizon: latestOf(pHorizons),
  });

  const scope = { creativeIds: [creativeId], ...range, includeExcluded };
  const [kd, byPlatform, byCampaign, dailyRows] = await Promise.all([
    kpisWithDelta(scope),
    platformMix(scope),
    campaignMix(scope),
    creativeDailyMetrics(scope, platformEdges),
  ]);

  // Revenue's delta isn't in the delta bundle, so derive it like the Dashboard does.
  const k = kd.current;
  const d = kd.delta;
  const revenueDelta = computeDelta(kd.current.conversionValue, kd.previous.conversionValue);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard label="Spend" value={usd0(k.spend)} icon={DollarSign} delta={d.spend} hideBreakdown />
        <MetricCard label="Conversions" value={int(k.conversions)} icon={Target} delta={d.conversions} hideBreakdown />
        <MetricCard label="Revenue" value={usd0(k.conversionValue)} icon={Banknote} delta={revenueDelta} hideBreakdown />
        <MetricCard label="CPA" value={usd(k.cpa)} icon={Receipt} delta={d.cpa} deltaInverted hideBreakdown />
        <MetricCard label="ROAS" value={roas(k.roas)} icon={TrendingUp} delta={d.roas} hideBreakdown />
      </div>

      <CreativePerfLineChart
        title="Performance over time"
        rows={dailyRows}
        fillFrom={groupBounds.fillFrom}
        fillTo={groupBounds.fillTo}
      />

      <div>
        <h3 className="text-sm font-medium text-ink mb-3">Campaigns</h3>
        <CreativeCampaignsTable campaigns={byCampaign} platforms={byPlatform} />
      </div>
    </>
  );
}

/** The records block, the activity feed and (with the permission) the danger zone. */
export async function CreativeRecordsActivity({
  creativeId,
  creativeName,
  range,
  recordsTitle,
  canDelete,
}: {
  creativeId: string;
  creativeName: string;
  range: Range;
  recordsTitle: string;
  canDelete: boolean;
}) {
  const [records, activity, deletionSummary] = await Promise.all([
    creativeRecords(creativeId, range),
    listAuditEvents({ entityType: "creative", entityId: creativeId, limit: 25 }),
    canDelete ? creativeDeletionSummary(creativeId) : Promise.resolve(null),
  ]);

  return (
    <>
      {/* Records (own block, collapsed by default) */}
      <CreativeRecordsTable rows={records} title={recordsTitle} />

      {/* Activity log */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-medium text-ink">Activity</h2>
          <span className="text-[11px] text-ink-3">
            {activity.length === 0
              ? "No activity recorded yet."
              : `Last ${activity.length} event${activity.length === 1 ? "" : "s"} for this creative.`}
          </span>
        </div>
        <AuditFeed rows={activity} />
      </div>

      {/* Danger zone (delete permission only) */}
      {deletionSummary && (
        <div className="rounded-xl border border-neg/30 bg-neg/5 p-4 md:p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-sm font-medium text-ink">Delete this creative</h2>
              <p className="text-xs text-ink-3 mt-0.5 max-w-xl">
                Permanently removes the creative, its angles, and all{" "}
                {int(deletionSummary.records)} of its performance
                records. This can&apos;t be undone and affects no other creative.
              </p>
            </div>
            <DeleteCreativeDialog
              creativeId={creativeId}
              creativeName={creativeName}
              summary={deletionSummary}
            />
          </div>
        </div>
      )}
    </>
  );
}
