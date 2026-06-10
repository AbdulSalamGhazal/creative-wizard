import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { campaignMeta } from "@/db/queries/campaign";
import { AnalyticsDateFilter } from "@/components/creative/analytics-date-filter";
import {
  BridgeSection,
  BridgeSkeleton,
  RawDataDisclosure,
  RawDataSkeleton,
  RetentionSection,
  StructurePanel,
  StructureSkeleton,
  VerdictPanel,
  VerdictSkeleton,
} from "@/components/campaign/campaign-diagnosis";
import { parseCampaignDetailParams } from "@/validators/campaign";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { isoDate } from "@/lib/format";
import { presetLabel, resolveDefaultRange } from "@/lib/date-presets";

export const dynamic = "force-dynamic";

/**
 * Campaign DIAGNOSIS page — its single job is to explain *why* a campaign wins
 * or loses (not to re-display its metrics; those lenses live on /funnel,
 * /trends, /summary, /compare, /creatives). Five panels: the verdict (index vs
 * within-audience baseline), the ROAS bridge (mix vs rate), creative
 * contributions, within-campaign winners/losers + money-left-on-the-table, and
 * (video only) retention zones. Raw records sit behind a disclosure.
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
  const decoded = decodeURIComponent(campaign);
  const parsed = parseCampaignDetailParams(sp);

  // Default to a concrete recent window when no range is set.
  const eff = resolveDefaultRange(parsed.from, parsed.to);
  const range = { from: eff.from, to: eff.to };
  const rangeLabel = presetLabel(eff.from, eff.to);

  const meta = await campaignMeta(decoded);
  if (!meta) notFound();

  const panelArgs = {
    campaign: decoded,
    range,
    includeExcluded: parsed.includeExcluded,
  };

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
          <AnalyticsDateFilter from={parsed.from ?? null} to={parsed.to ?? null} />
        </div>

        <div className="space-y-2 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3">
            {meta.productNames.join(" · ") || "Campaign"}
          </div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight break-words">
            {meta.campaign}
          </h1>
          <div className="flex items-center gap-2 flex-wrap text-xs">
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

      {/* ─────────── Diagnostic panels ─────────── */}
      <Suspense fallback={<VerdictSkeleton />}>
        <VerdictPanel {...panelArgs} />
      </Suspense>

      <Suspense fallback={<BridgeSkeleton />}>
        <BridgeSection {...panelArgs} compare={parsed.compare} />
      </Suspense>

      <Suspense fallback={<StructureSkeleton />}>
        <StructurePanel {...panelArgs} />
      </Suspense>

      {/* Video-only — renders nothing when the campaign has no video creatives. */}
      <Suspense fallback={null}>
        <RetentionSection {...panelArgs} />
      </Suspense>

      <Suspense fallback={<RawDataSkeleton />}>
        <RawDataDisclosure {...panelArgs} />
      </Suspense>
    </div>
  );
}
