import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth, can } from "@/lib/auth";
import { campaignAnalytics, campaignCreatives } from "@/db/queries/campaign";
import {
  parentCampaignAdSets,
  parentCampaignDailyByAdSet,
  parentCampaignDeletionSummary,
  parentCampaignMeta,
} from "@/db/queries/parent-campaign";
import { dataHorizon, resolveEntityBounds } from "@/db/queries/series-bounds";
import { AnalyticsDateFilter } from "@/components/creative/analytics-date-filter";
import { CampaignCreativeKpis } from "@/components/campaign/campaign-creative-kpis";
import { CampaignCreativeChart } from "@/components/campaign/campaign-creative-chart";
import { CampaignCreativesTable } from "@/components/campaign/campaign-creatives-table";
import { ParentAdSetsTable } from "@/components/campaign/parent-ad-sets-table";
import { ParentCampaignEditDialog } from "@/components/campaign/parent-campaign-edit-dialog";
import { AddAdSetDialog } from "@/components/campaign/add-ad-set-dialog";
import { DeleteParentCampaignDialog } from "@/components/campaign/delete-parent-campaign-dialog";
import { CampaignStatusBadge } from "@/components/campaign/campaign-status-badge";
import { AD_NETWORK_LABEL, adSetLabel } from "@/lib/campaign";
import { parseCampaignDetailParams } from "@/validators/campaign";
import { safeDecodeURIComponent } from "@/lib/url";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CommentAnchor } from "@/components/comments/comment-anchor-context";
import { isoDate, int } from "@/lib/format";
import { defaultDateRange } from "@/lib/date-presets";
import { resolvePreferredRange, resolveIncludeExcluded } from "@/db/queries/user-prefs";
import { ExcludedParamToggle } from "@/components/filters/excluded-param-toggle";
import { DangerZone } from "@/components/ui/callout";
import { TABLE_KEYS } from "@/lib/table-columns";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import Link from "@/components/nav/link";

export const dynamic = "force-dynamic";

type Params = Promise<{ network: string; campaign: string }>;

/**
 * Tab title: "Campaign · <name> · Wizard". `parentCampaignMeta` is
 * cache()-wrapped, so this shares the page's fetch. Unknown → the section name.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { network, campaign } = await params;
  const meta = await parentCampaignMeta(
    safeDecodeURIComponent(network),
    safeDecodeURIComponent(campaign),
  );
  return { title: meta ? `Campaign · ${meta.name}` : "Campaigns" };
}

/**
 * CAMPAIGN detail (2026-11) — a `parent_campaigns` row and everything under
 * it. Top to bottom:
 *  1. headline KPIs, each broken down by AD SET,
 *  2. one line per ad set over time,
 *  3. its ad sets, side by side (every registered one, data or not),
 *  4. the creatives that ran anywhere in it.
 *
 * Every number is the component sum of the campaign's records (the ad-set
 * queries with a `{ parentId }` scope) — never a roll-up of per-ad-set ratios.
 * REGISTRY-FIRST: the page opens before any upload, so "Add ad set" is always
 * reachable.
 */
export default async function ParentCampaignPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<{
    from?: string;
    to?: string;
    includeExcluded?: string;
    addAdSet?: string | string[];
  }>;
}) {
  const { network, campaign } = await params;
  const sp = await searchParams;
  const parsed = parseCampaignDetailParams(sp);

  const meta = await parentCampaignMeta(
    safeDecodeURIComponent(network),
    safeDecodeURIComponent(campaign),
  );
  if (!meta) notFound();

  const eff = await resolvePreferredRange(parsed.from, parsed.to, defaultDateRange());
  const range = { from: eff.from, to: eff.to };
  const scope = { parentId: meta.id };

  const user = await auth();
  const canDelete = user ? can(user, "campaign.delete") : false;
  const canUpload = user ? can(user, "upload.import") : false;

  // Effective Excluded state: URL param wins, else the user's saved default.
  const inc = await resolveIncludeExcluded(sp.includeExcluded);
  const [analytics, adSetRows, daily, creativeRows, horizon, deletionSummary] = await Promise.all([
    campaignAnalytics(scope, range, inc),
    parentCampaignAdSets(meta.id, range, inc),
    parentCampaignDailyByAdSet(meta.id, range, inc),
    campaignCreatives(scope, range, inc),
    dataHorizon(),
    // Only rendered inside the `canDelete` danger zone.
    canDelete ? parentCampaignDeletionSummary(meta.id) : Promise.resolve(null),
  ]);

  // Edge-fill bounds for the GROUP line: trailing zeros to the data horizon (a
  // paused campaign shows the pause), leading zeros from the window start only
  // if the campaign existed before it.
  const chartBounds = resolveEntityBounds({
    from: range.from,
    to: range.to,
    firstEver: meta.firstDate,
    horizon,
  });

  // The ad sets WITH data in the range, by spend — the series of the KPI bars
  // and the chart, and the colour order the table's dots follow.
  const series = adSetRows
    .filter((a) => a.spend !== null)
    .map((a) => ({
      creativeId: a.id,
      name: adSetLabel(a.name),
      spend: a.spend ?? 0,
      conversions: a.orders ?? 0,
      conversionValue: a.revenue ?? 0,
      roas: a.roas,
      cpa: a.cpa,
      ctr: a.ctr,
      cvr: a.cvr,
    }));

  // The upload report's way in: `?addAdSet=<name>` opens "Add ad set" on an
  // ad set a file named that this campaign doesn't have yet — unless someone
  // has registered it since.
  const known = new Set(meta.adSets.map((a) => a.adsetName));
  const prefill = [sp.addAdSet ?? []]
    .flat()
    .map((n) => n.trim())
    .filter((n) => n !== "" && n.length <= 400 && !known.has(n))
    .slice(0, 20);

  return (
    <PageShell>
      {/* The drawer anchors to the campaign itself (its row), so a rename
          never moves its thread. */}
      <CommentAnchor type="parent_campaign" id={meta.id} />
      <PageHeader
        backLink={{ href: "/campaigns", label: "Back to Campaigns" }}
        eyebrow={meta.productNames.join(" · ") || "Campaign"}
        title={meta.name}
        clampTitle
        rightSlot={
          <div className="flex flex-wrap items-center gap-2">
            <ParentCampaignEditDialog id={meta.id} name={meta.name} adSetCount={meta.adSets.length} />
            <AddAdSetDialog
              // A different prefill is a different dialog: it must re-open.
              key={prefill.join("\u0001")}
              parentId={meta.id}
              campaignName={meta.name}
              network={meta.network}
              prefill={prefill}
            />
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
        {/* One muted meta line (R-065), the ad set page's own shape. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
          <CampaignStatusBadge status={meta.status} />
          <span aria-hidden className="text-ink-3">·</span>
          <span>{AD_NETWORK_LABEL[meta.network]}</span>
          <span aria-hidden className="text-ink-3">·</span>
          <span className="tabular-nums">
            {int(meta.adSets.length)} ad set{meta.adSets.length === 1 ? "" : "s"}
          </span>
          <span aria-hidden className="text-ink-3">·</span>
          <span className="tabular-nums">
            {int(meta.creativeCount)} creative{meta.creativeCount === 1 ? "" : "s"}
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
          {/* 1 ─── Headline KPIs, broken down by ad set ─── */}
          <CampaignCreativeKpis analytics={analytics} creatives={series} />

          {/* 2 ─── One line per ad set over time ─── */}
          <CampaignCreativeChart
            points={daily}
            creatives={series.map((s) => ({ creativeId: s.creativeId, name: s.name }))}
            fillFrom={chartBounds.fillFrom}
            fillTo={chartBounds.fillTo}
            seriesNoun="ad set"
          />
        </>
      ) : (
        // Registered, never uploaded: ONE state, not seven empty tiles and an
        // empty chart each offering a wider range that would change nothing.
        <EmptyState
          title="No data yet"
          hint="Numbers appear after the first upload that includes these ad sets."
          action={
            canUpload ? (
              <Button asChild size="sm">
                <Link href="/uploads/new">Upload ads</Link>
              </Button>
            ) : undefined
          }
        />
      )}

      {/* 3 ─── Its ad sets, side by side ─── */}
      <div className="space-y-2">
        <h2 className="text-label text-ink-3">Ad sets</h2>
        <ParentAdSetsTable adSets={adSetRows} />
      </div>

      {/* 4 ─── The creatives that ran anywhere in it ─── */}
      {meta.hasRecords && (
        <div className="space-y-2">
          <h2 className="text-label text-ink-3">Creatives</h2>
          <CampaignCreativesTable
            creatives={creativeRows}
            tableKey={TABLE_KEYS.PARENT_CAMPAIGN_CREATIVES}
            seriesDots={false}
            emptyTitle="No creatives ran in this campaign in this window."
          />
        </div>
      )}

      {/* ─────────── Danger zone (delete permission only) ─────────── */}
      {canDelete && deletionSummary && (
        <DangerZone>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-sm font-medium text-ink">Delete this campaign</h2>
              <p className="text-xs text-ink-3 mt-0.5 max-w-xl">
                {deletionSummary.records > 0 ? (
                  <>
                    Permanently removes the campaign, its {int(deletionSummary.adSets)} ad set
                    {deletionSummary.adSets === 1 ? "" : "s"} and all{" "}
                    {int(deletionSummary.records)} of their performance records. The{" "}
                    {int(deletionSummary.creatives)} creative
                    {deletionSummary.creatives === 1 ? "" : "s"} that ran here are kept.
                  </>
                ) : deletionSummary.adSets > 0 ? (
                  <>
                    Permanently removes the campaign and its {int(deletionSummary.adSets)} ad set
                    {deletionSummary.adSets === 1 ? "" : "s"}. It has no performance records.
                  </>
                ) : (
                  <>Permanently removes the campaign. It has no ad sets or records.</>
                )}{" "}
                This can&apos;t be undone.
              </p>
            </div>
            <DeleteParentCampaignDialog
              parentId={meta.id}
              campaignName={meta.name}
              summary={deletionSummary}
            />
          </div>
        </DangerZone>
      )}
    </PageShell>
  );
}
