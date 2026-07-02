import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  campaignAnalytics,
  campaignCreatives,
  campaignDailyByCreative,
  campaignDeletionSummary,
  campaignMeta,
  campaignRecords,
  campaignRecordsByDay,
  campaignRegistry,
} from "@/db/queries/campaign";
import { AnalyticsDateFilter } from "@/components/creative/analytics-date-filter";
import { CampaignCreativeKpis } from "@/components/campaign/campaign-creative-kpis";
import { CampaignCreativeChart } from "@/components/campaign/campaign-creative-chart";
import { CampaignCreativesTable } from "@/components/campaign/campaign-creatives-table";
import { CampaignEditDialog } from "@/components/campaign/campaign-edit-dialog";
import { DeleteCampaignDialog } from "@/components/campaign/delete-campaign-dialog";
import { CampaignRecordsTable } from "@/components/campaign/campaign-records-table";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { parseCampaignName } from "@/lib/campaign";
import { campaignStatusFor, campaignStatusMap } from "@/db/queries/campaign-status";
import { CAMPAIGN_STATUS_DOT, CAMPAIGN_STATUS_LABEL } from "@/lib/campaign-status";
import { parseCampaignDetailParams } from "@/validators/campaign";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { safeDecodeURIComponent } from "@/lib/url";
import { isoDate } from "@/lib/format";
import { defaultDateRange, presetLabel } from "@/lib/date-presets";
import { resolvePreferredRange } from "@/db/queries/user-prefs";

export const dynamic = "force-dynamic";

/**
 * Campaign detail. Three lenses, top to bottom:
 *  1. headline KPIs, each broken down by creative,
 *  2. one line per creative over time (any metric, smooth, expand),
 *  3. the raw uploaded rows (per record or grouped by day, sortable, all fields).
 */
export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaign: string }>;
  searchParams: Promise<{
    from?: string;
    to?: string;
    compare?: string;
    includeExcluded?: string;
  }>;
}) {
  const { campaign } = await params;
  const sp = await searchParams;
  const decoded = safeDecodeURIComponent(campaign);
  const parsed = parseCampaignDetailParams(sp);

  const eff = await resolvePreferredRange(parsed.from, parsed.to, defaultDateRange());
  const range = { from: eff.from, to: eff.to };
  const rangeLabel = presetLabel(eff.from, eff.to);

  const meta = await campaignMeta(decoded);
  if (!meta) notFound();

  // Registry row (id/platform/objective) backs the edit dialog; parse the stored
  // name back into Campaign + Ad Set so the form pre-fills cleanly.
  const registry = await campaignRegistry(decoded);
  const nameParts = registry ? parseCampaignName(decoded, registry.platform) : null;
  // Status (current liveness) + deletion summary (what the danger zone removes),
  // fetched in parallel — both keyed on the registry id.
  const [campaignStatus, deletionSummary] = registry
    ? await Promise.all([
        campaignStatusMap([registry.id]).then((m) =>
          campaignStatusFor(m, registry.id),
        ),
        campaignDeletionSummary(registry.id),
      ])
    : [null, null];

  const inc = parsed.includeExcluded;
  const [analytics, creativeRows, daily, records, byDay] = await Promise.all([
    campaignAnalytics(decoded, range, inc),
    campaignCreatives(decoded, range, inc),
    campaignDailyByCreative(decoded, range, inc),
    campaignRecords(decoded, range, inc),
    campaignRecordsByDay(decoded, range, inc),
  ]);

  const legendCreatives = creativeRows.map((c) => ({
    creativeId: c.creativeId,
    name: c.name,
  }));

  return (
    <div className="space-y-6">
      {/* ─────────── Header ─────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            All campaigns
          </Link>
          <div className="flex items-center gap-2">
            {registry && nameParts && (
              <CampaignEditDialog
                id={registry.id}
                currentName={meta.campaign}
                campaign={nameParts.campaign}
                adset={nameParts.adset}
                platform={registry.platform}
                objective={registry.objective}
              />
            )}
            <AnalyticsDateFilter
              from={parsed.from ?? null}
              to={parsed.to ?? null}
              defaultFrom={eff.from}
              defaultTo={eff.to}
            />
          </div>
        </div>

        <div className="space-y-2 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3">
            {meta.productNames.join(" · ") || "Campaign"}
          </div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight break-words">
            {meta.campaign}
          </h1>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Badge variant="outline" className="border-brand/40 text-ink">
              <Target className="w-3 h-3 mr-1" />
              {meta.objective}
            </Badge>
            {campaignStatus && (
              <Badge variant="outline" className="text-ink-2">
                <span
                  className="w-1.5 h-1.5 rounded-sm mr-1.5"
                  style={{ background: CAMPAIGN_STATUS_DOT[campaignStatus] }}
                />
                {CAMPAIGN_STATUS_LABEL[campaignStatus]}
              </Badge>
            )}
            {meta.platforms.map((p) => (
              <Badge key={p} variant="outline" className="text-ink-2">
                <span
                  className="w-1.5 h-1.5 rounded-sm mr-1.5"
                  style={{ background: PLATFORM_COLOR[p] }}
                />
                {PLATFORM_LABEL[p]}
              </Badge>
            ))}
            <Badge variant="outline" className="text-ink-3">
              {meta.creativeCount} creative{meta.creativeCount === 1 ? "" : "s"}
            </Badge>
            {meta.firstDate && meta.lastDate && (
              <Badge variant="outline" className="text-ink-3 num">
                Active {isoDate(meta.firstDate)} → {isoDate(meta.lastDate)}
              </Badge>
            )}
            <Badge variant="outline" className="text-ink-3 num">
              {rangeLabel}
            </Badge>
          </div>
        </div>
      </section>

      {/* 1 ─── Headline KPIs, broken down by creative ─── */}
      <CampaignCreativeKpis analytics={analytics} creatives={creativeRows} />

      {/* 2 ─── One line per creative over time ─── */}
      <CampaignCreativeChart points={daily} creatives={legendCreatives} />

      {/* 2½ ─── The chart's creatives, tabulated ─── */}
      <div className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
          Creatives
        </h2>
        <CampaignCreativesTable creatives={creativeRows} />
      </div>

      {/* 3 ─── Raw uploaded rows — collapsed by default ─── */}
      <CollapsibleSection
        title="Row data"
        subtitle={`${records.length}${records.length >= 2000 ? "+" : ""} records`}
      >
        <CampaignRecordsTable records={records} byDay={byDay} campaign={decoded} />
      </CollapsibleSection>

      {/* ─────────── Danger zone ─────────── */}
      {registry && deletionSummary && (
        <div className="rounded-xl border border-neg/30 bg-neg/5 p-4 md:p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-sm font-medium text-ink">
                Delete this campaign
              </h2>
              <p className="text-xs text-ink-3 mt-0.5 max-w-xl">
                Permanently removes the campaign and all{" "}
                {deletionSummary.records.toLocaleString()} of its performance
                records. The {deletionSummary.creatives.toLocaleString()} creative
                {deletionSummary.creatives === 1 ? "" : "s"} that ran here are
                kept. This can&apos;t be undone.
              </p>
            </div>
            <DeleteCampaignDialog
              campaignId={registry.id}
              campaignName={meta.campaign}
              summary={deletionSummary}
            />
          </div>
        </div>
      )}
    </div>
  );
}
