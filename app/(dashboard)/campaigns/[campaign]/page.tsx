import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  campaignAnalytics,
  campaignCreatives,
  campaignDaily,
  campaignMeta,
  campaignPlatforms,
  campaignRecords,
} from "@/db/queries/campaign";
import { KpiTile } from "@/components/kpi/kpi-tile";
import { FunnelStages } from "@/components/funnel/funnel-stages";
import { FunnelTrendChart } from "@/components/funnel/funnel-trend-chart";
import { CampaignTrendChart } from "@/components/campaign/campaign-trend-chart";
import { CampaignPlatformTable } from "@/components/campaign/campaign-platform-table";
import { CampaignCreativesTable } from "@/components/campaign/campaign-creatives-table";
import { CampaignRecordsTable } from "@/components/campaign/campaign-records-table";
import { AnalyticsDateFilter } from "@/components/creative/analytics-date-filter";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { int, isoDate, pct, ratio, usd } from "@/lib/format";
import type { Delta } from "@/lib/period";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaign: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { campaign } = await params;
  const sp = await searchParams;
  const decoded = decodeURIComponent(campaign);

  const from = ISO_DATE.test(sp.from ?? "") ? sp.from : undefined;
  const to = ISO_DATE.test(sp.to ?? "") ? sp.to : undefined;
  const range = from && to ? { from, to } : {};
  const rangeLabel = from && to ? `${from} → ${to}` : "All-time";

  const meta = await campaignMeta(decoded);
  if (!meta) notFound();

  const [analytics, daily, platforms, creatives, records] = await Promise.all([
    campaignAnalytics(decoded, range),
    campaignDaily(decoded, range),
    campaignPlatforms(decoded, range),
    campaignCreatives(decoded, range),
    campaignRecords(decoded, range),
  ]);

  const t = analytics.totals;
  const d = analytics.deltas;
  const caption = rangeLabel;

  const tiles: Array<{
    label: string;
    value: string;
    delta?: Delta;
    inverted?: boolean;
  }> = [
    { label: "Spend", value: usd(t.spend), delta: d?.spend },
    { label: "Impressions", value: int(t.impressions), delta: d?.impressions },
    { label: "Clicks", value: int(t.clicks), delta: d?.clicks },
    { label: "Conversions", value: int(t.conversions), delta: d?.conversions },
    { label: "Conv. value", value: usd(t.conversionValue), delta: d?.conversionValue },
    { label: "ROAS", value: ratio(t.roas), delta: d?.roas },
    { label: "CTR", value: pct(t.ctr), delta: d?.ctr },
    { label: "CvR", value: pct(t.cvr), delta: d?.cvr },
    { label: "VOC", value: pct(t.voc), delta: d?.voc },
    { label: "CPA", value: usd(t.cpa), delta: d?.cpa, inverted: true },
    { label: "CPM", value: usd(t.cpm), delta: d?.cpm, inverted: true },
    { label: "CPC", value: usd(t.cpc), delta: d?.cpc, inverted: true },
  ];

  const dailyRates = daily.map((p) => ({
    date: p.date,
    cpm: p.cpm,
    ctr: p.ctr,
    voc: p.voc,
    cvr: p.cvr,
  }));

  const hasVideo = t.videoViews2s > 0;

  return (
    <div className="space-y-10">
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
          <AnalyticsDateFilter from={from ?? null} to={to ?? null} />
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
          </div>
        </div>
      </section>

      {/* ─────────── KPIs ─────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl tracking-tight">Metrics</h2>
          <span className="text-[11px] text-ink-3 num">
            {rangeLabel}
            {d ? " · vs prior window" : ""}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {tiles.map((tile) => (
            <KpiTile
              key={tile.label}
              label={tile.label}
              value={tile.value}
              delta={tile.delta}
              inverted={tile.inverted}
            />
          ))}
        </div>
      </section>

      {/* ─────────── Funnel ─────────── */}
      <Section title="Funnel" hint="impression → click → LP view → conversion">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FunnelStages totals={t} />
          <FunnelTrendChart points={dailyRates} />
        </div>
      </Section>

      {/* ─────────── Performance over time ─────────── */}
      <Section title="Over time" hint={caption}>
        <CampaignTrendChart points={daily} />
      </Section>

      {/* ─────────── Platform breakdown ─────────── */}
      <Section
        title="By platform"
        hint={`${platforms.length} platform${platforms.length === 1 ? "" : "s"}`}
      >
        <CampaignPlatformTable rows={platforms} />
      </Section>

      {/* ─────────── Video engagement (only when there's video data) ─────────── */}
      {hasVideo && (
        <Section title="Video engagement" hint="across video creatives in this campaign">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile label="2s views" value={int(t.videoViews2s)} />
            <KpiTile label="Hook rate" value={pct(t.hookRate)} />
            <KpiTile label="Hold rate" value={pct(t.holdRate)} />
            <KpiTile label="Complete rate" value={pct(t.completeRate)} />
          </div>
        </Section>
      )}

      {/* ─────────── Creatives ─────────── */}
      <Section
        title="Creatives in this campaign"
        hint={`${creatives.length} · by spend — open one for its own analysis`}
      >
        <CampaignCreativesTable rows={creatives} />
      </Section>

      {/* ─────────── Records ─────────── */}
      <Section
        title={from && to ? "Records in range" : "All records"}
        hint={records.length >= 500 ? "showing first 500" : `${records.length} rows`}
      >
        <CampaignRecordsTable rows={records} />
      </Section>
    </div>
  );
}
