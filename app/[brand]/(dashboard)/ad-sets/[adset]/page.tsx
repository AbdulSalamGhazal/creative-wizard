import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/nav/link";
import { auth, can } from "@/lib/auth";
import {
  campaignAnalytics,
  campaignCreatives,
  campaignDailyByCreative,
  campaignDeletionSummary,
  campaignMeta,
  campaignRecords,
  campaignRecordsByDay,
} from "@/db/queries/campaign";
import { dataHorizon, resolveEntityBounds } from "@/db/queries/series-bounds";
import { AnalyticsDateFilter } from "@/components/creative/analytics-date-filter";
import { CampaignCreativeKpis } from "@/components/campaign/campaign-creative-kpis";
import { CampaignCreativeChart } from "@/components/campaign/campaign-creative-chart";
import { CampaignCreativesTable } from "@/components/campaign/campaign-creatives-table";
import { CampaignEditDialog } from "@/components/campaign/campaign-edit-dialog";
import { DeleteCampaignDialog } from "@/components/campaign/delete-campaign-dialog";
import { CampaignRecordsTable } from "@/components/campaign/campaign-records-table";
import { resolveTablePrefs } from "@/db/queries/user-prefs";
import { TABLE_KEYS } from "@/lib/table-columns";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { campaignPath, parseCampaignName } from "@/lib/campaign";
import { campaignStatusFor, campaignStatusMap } from "@/db/queries/campaign-status";
import { CampaignStatusBadge } from "@/components/campaign/campaign-status-badge";
import { PlatformDot } from "@/components/ui/platform-dot";
import { parseCampaignDetailParams } from "@/validators/campaign";
import { PLATFORM_LABEL } from "@/lib/palette";
import { safeDecodeURIComponent, withDateRange } from "@/lib/url";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CommentAnchor } from "@/components/comments/comment-anchor-context";
import { isoDate, int } from "@/lib/format";
import { defaultDateRange } from "@/lib/date-presets";
import { resolvePreferredRange, resolveIncludeExcluded } from "@/db/queries/user-prefs";
import { ExcludedParamToggle } from "@/components/filters/excluded-param-toggle";
import { DangerZone } from "@/components/ui/callout";
import { CompareLink, compareHref } from "@/components/compare/compare-link";
import { RailLinks } from "@/components/layout/rail-links";
import { CanvasLink } from "@/components/canvas/canvas-link";
import { canvasFocusHref } from "@/lib/canvas";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * AD SET detail — a `campaigns` row, the level under a Campaign (2026-11;
 * lib/campaign.ts, "TWO LEVELS"). Until then this page was `/campaigns/<name>`.
 * Three lenses, top to bottom:
 *  1. headline KPIs, each broken down by creative,
 *  2. one line per creative over time (any metric, smooth, expand),
 *  3. the raw uploaded rows (per record or grouped by day, sortable, all fields).
 *
 * REGISTRY-FIRST: an ad set with no records yet still opens (its sections are
 * empty) — it must be reachable to fix a name before its first upload.
 */
/**
 * Tab title: "Ad set · <name> · Wizard". `campaignMeta` is cache()-wrapped, so
 * this shares the page's fetch rather than querying twice. The stored name keeps
 * its `➤` / `(IG)` decoration — decode the URL param so the tab shows it as
 * written, not percent-encoded. Unknown ad set → the section name.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ adset: string }>;
}): Promise<Metadata> {
  const { adset } = await params;
  const meta = await campaignMeta(safeDecodeURIComponent(adset));
  return { title: meta ? `Ad set · ${meta.campaign}` : "Ad sets" };
}

export default async function AdSetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ adset: string }>;
  searchParams: Promise<{
    from?: string;
    to?: string;
    compare?: string;
    includeExcluded?: string;
  }>;
}) {
  const { adset } = await params;
  const sp = await searchParams;
  const decoded = safeDecodeURIComponent(adset);
  const parsed = parseCampaignDetailParams(sp);

  const eff = await resolvePreferredRange(parsed.from, parsed.to, defaultDateRange());
  const range = { from: eff.from, to: eff.to };

  const meta = await campaignMeta(decoded);
  if (!meta) notFound();

  const user = await auth();
  const canDelete = user ? can(user, "campaign.delete") : false;
  const canUpload = user ? can(user, "upload.import") : false;

  // The campaign part of the stored name: its campaign's own name — or, for a
  // row the reconcile hasn't reached, the part the stored name carries.
  const nameParts = parseCampaignName(decoded, meta.platform);
  const campaignName = meta.parent?.name ?? nameParts.campaign;
  const campaignHref = meta.parent ? campaignPath(meta.parent.network, meta.parent.name) : null;

  // Status (current liveness) + deletion summary (what the danger zone removes),
  // fetched in parallel — both keyed on the registry id. The deletion summary
  // is ONLY rendered inside the `canDelete` danger zone, so a viewer who can
  // never see it no longer pays for the count.
  const [campaignStatus, deletionSummary] = await Promise.all([
    campaignStatusMap([meta.id]).then((m) => campaignStatusFor(m, meta.id)),
    canDelete ? campaignDeletionSummary(meta.id) : Promise.resolve(null),
  ]);

  // Effective Excluded state: URL param wins, else the user's saved default.
  const inc = await resolveIncludeExcluded(sp.includeExcluded);
  const [
    analytics,
    creativeRows,
    daily,
    records,
    byDay,
    horizon,
    tablePrefs,
  ] = await Promise.all([
    campaignAnalytics(decoded, range, inc),
    campaignCreatives(decoded, range, inc),
    campaignDailyByCreative(decoded, range, inc),
    campaignRecords(decoded, range, inc),
    campaignRecordsByDay(decoded, range, inc),
    dataHorizon(),
    // Remembered columns for the records table — ONE read, cache()-deduped,
    // resolved here so the table renders the user's choice on first paint.
    resolveTablePrefs([TABLE_KEYS.CAMPAIGN_RECORDS]),
  ]);

  // The ad set's first-ever day is `meta.firstDate`: the same rows (the
  // name is unique per brand, and every record joins a creative and product),
  // so it needs no query of its own.
  const campaignFirst = meta.firstDate;

  // Edge-fill bounds for the GROUP line: trailing zeros to the data horizon
  // (a paused ad set shows the pause), leading zeros from the window start
  // only if the ad set existed before it.
  const chartBounds = resolveEntityBounds({
    from: range.from,
    to: range.to,
    firstEver: campaignFirst,
    horizon,
  });

  const legendCreatives = creativeRows.map((c) => ({
    creativeId: c.creativeId,
    name: c.name,
  }));

  return (
    <PageShell>
      {/* The drawer anchors to the ad set itself (registry row), so a
          rename never moves its thread. */}
      <CommentAnchor type="campaign" id={meta.id} />
      {/* ─────────── Header — the shared PageHeader (D26): one back link,
          one title size; the controls wrap under it on a phone. ─────────── */}
      <PageHeader
        backLink={{ href: "/ad-sets", label: "Back to Ad sets" }}
        eyebrow={meta.productNames.join(" · ") || "Ad set"}
        title={meta.campaign}
        clampTitle
        rightSlot={
          <div className="flex flex-wrap items-center gap-2">
            <CampaignEditDialog
              id={meta.id}
              currentName={meta.campaign}
              campaign={campaignName}
              network={meta.parent?.network ?? null}
              adset={meta.adsetName ?? nameParts.adset}
              platform={meta.platform}
              objective={meta.objective}
              hasRecords={meta.hasRecords}
            />
            {/* Into Compare with this ad set as side A (R-045), and onto
                the Canvas. From lg they live in the rail (2026-11-21). */}
            <RailLinks
              compare={compareHref({ campaigns: meta.campaign }, eff)}
              canvas={canvasFocusHref({ campaignId: meta.id }, eff)}
            />
            <CompareLink side={{ campaigns: meta.campaign }} from={eff.from} to={eff.to} className="lg:hidden" />
            <CanvasLink entity={{ campaignId: meta.id }} from={eff.from} to={eff.to} className="lg:hidden" />
            <ExcludedParamToggle on={inc} />
            <AnalyticsDateFilter
              from={parsed.from ?? null}
              to={parsed.to ?? null}
              defaultFrom={eff.from}
              defaultTo={eff.to}
            />
          </div>
        }
      >
        {/* One muted meta line, not a wall of equal-weight pills (R-065): the
            status is the bare StatusDot it is everywhere else. The campaign
            it belongs to leads — the way up. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
          {campaignHref && (
            <>
              <Link
                href={withDateRange(campaignHref, eff.from, eff.to)}
                className="text-ink underline-offset-2 hover:underline"
                dir="auto"
              >
                <span className="sr-only">Campaign: </span>
                {campaignName}
              </Link>
              <span aria-hidden className="text-ink-3">·</span>
            </>
          )}
          <CampaignStatusBadge status={campaignStatus} />
          <span aria-hidden className="text-ink-3">·</span>
          <span>{meta.objective}</span>
          {meta.platforms.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="text-ink-3">·</span>
              <PlatformDot platform={p} size="sm" />
              {PLATFORM_LABEL[p]}
            </span>
          ))}
          <span aria-hidden className="text-ink-3">·</span>
          <span className="tabular-nums">
            {meta.creativeCount} creative{meta.creativeCount === 1 ? "" : "s"}
          </span>
          {meta.firstDate && meta.lastDate && (
            <>
              <span aria-hidden className="text-ink-3">·</span>
              <span className="tabular-nums">
                {isoDate(meta.firstDate)} → {isoDate(meta.lastDate)}
              </span>
            </>
          )}
        </div>
      </PageHeader>

      {meta.hasRecords ? (
        <>
          {/* 1 ─── Headline KPIs, broken down by creative ─── */}
          <CampaignCreativeKpis analytics={analytics} creatives={creativeRows} />

          {/* 2 ─── One line per creative over time ─── */}
          <CampaignCreativeChart
            points={daily}
            creatives={legendCreatives}
            fillFrom={chartBounds.fillFrom}
            fillTo={chartBounds.fillTo}
          />

          {/* 2½ ─── The chart's creatives, tabulated ─── */}
          <div className="space-y-2">
            <h2 className="text-label text-ink-3">
              Creatives
            </h2>
            <CampaignCreativesTable creatives={creativeRows} />
          </div>

          {/* 3 ─── Raw uploaded rows — collapsed by default ─── */}
          <CollapsibleSection
            title="Row data"
            subtitle={`${records.length}${records.length >= 2000 ? "+" : ""} records`}
          >
            <CampaignRecordsTable
              records={records}
              byDay={byDay}
              campaign={decoded}
              columnPref={tablePrefs[TABLE_KEYS.CAMPAIGN_RECORDS]}
            />
          </CollapsibleSection>
        </>
      ) : (
        // Registered, never uploaded (2026-11): ONE state — the name above is
        // what an upload must match, and it can still be edited here.
        <EmptyState
          title="No data yet"
          hint="Numbers appear after the first upload that names this ad set exactly as above."
          action={
            canUpload ? (
              <Button asChild size="sm">
                <Link href="/uploads/new">Upload ads</Link>
              </Button>
            ) : undefined
          }
        />
      )}

      {/* ─────────── Danger zone (delete permission only) ─────────── */}
      {canDelete && deletionSummary && (
        <DangerZone>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-sm font-medium text-ink">
                Delete this ad set
              </h2>
              <p className="text-xs text-ink-3 mt-0.5 max-w-xl">
                {deletionSummary.records > 0 ? (
                  <>
                    Permanently removes the ad set and all{" "}
                    {int(deletionSummary.records)} of its performance
                    records. The {int(deletionSummary.creatives)} creative
                    {deletionSummary.creatives === 1 ? "" : "s"} that ran here are
                    kept, and so is its campaign.
                  </>
                ) : (
                  <>
                    Permanently removes the ad set. It has no performance records;
                    its campaign is kept.
                  </>
                )}{" "}
                This can&apos;t be undone.
              </p>
            </div>
            <DeleteCampaignDialog
              campaignId={meta.id}
              campaignName={meta.campaign}
              summary={deletionSummary}
              afterHref={campaignHref ?? "/ad-sets"}
            />
          </div>
        </DangerZone>
      )}
    </PageShell>
  );
}
