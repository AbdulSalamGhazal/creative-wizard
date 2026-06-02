import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  kpis,
  platformMix,
  spendByDatePlatform,
} from "@/db/queries/performance";
import {
  creativeDeletionSummary,
  creativeRecords,
  getCreativeByName,
  listAllTags,
} from "@/db/queries/creatives";
import { listProducts } from "@/db/queries/products";
import { listAuditEvents } from "@/db/queries/audit";
import { CreativeDetailHeader } from "@/components/creative/creative-detail-header";
import { DeleteCreativeDialog } from "@/components/creative/delete-creative-dialog";
import { CreativePerfLineChart } from "@/components/charts/creative-perf-line";
import { CreativePlatformTable } from "@/components/creative/creative-platform-table";
import { CreativeRecordsTable } from "@/components/creative/creative-records-table";
import { AnalyticsDateFilter } from "@/components/creative/analytics-date-filter";
import { NotesPanel } from "@/components/creative/notes-panel";
import { AuditFeed } from "@/components/audit/audit-feed";
import { int, pct, ratio, usd } from "@/lib/format";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function CreativeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { name } = await params;
  const sp = await searchParams;
  const decoded = decodeURIComponent(name);

  const from = ISO_DATE.test(sp.from ?? "") ? sp.from : undefined;
  const to = ISO_DATE.test(sp.to ?? "") ? sp.to : undefined;
  // Only treat as a bounded range when BOTH ends are present.
  const range = from && to ? { from, to } : {};
  const rangeLabel = from && to ? `${from} → ${to}` : "All-time";

  const creative = await getCreativeByName(decoded);
  if (!creative) {
    notFound();
  }

  const [
    k,
    byPlatform,
    perfRows,
    records,
    activity,
    deletionSummary,
    allTags,
    products,
  ] = await Promise.all([
    kpis({ creativeIds: [creative.id], ...range }),
    platformMix({ creativeIds: [creative.id], ...range }),
    spendByDatePlatform({ creativeIds: [creative.id], ...range }),
    creativeRecords(creative.id, range),
    listAuditEvents({
      entityType: "creative",
      entityId: creative.id,
      limit: 25,
    }),
    creativeDeletionSummary(creative.id),
    listAllTags(),
    listProducts(),
  ]);

  const tiles = [
    { label: "Spend", value: usd(k.spend) },
    { label: "Impressions", value: int(k.impressions) },
    { label: "Blended CTR", value: pct(k.ctr) },
    { label: "Conversions", value: int(k.conversions) },
    { label: "Blended CPA", value: usd(k.cpa) },
    { label: "Blended ROAS", value: ratio(k.roas) },
  ];

  return (
    <div className="space-y-10">
      {/* ─────────── Information ─────────── */}
      <section className="space-y-6">
        <CreativeDetailHeader
          creative={creative}
          allTags={allTags}
          products={products}
        />
        <NotesPanel creativeId={creative.id} initialNotes={creative.notes} />
      </section>

      {/* ─────────── Analytics ─────────── */}
      <section className="space-y-8 rounded-xl border border-line bg-surface/40 p-4 md:p-6">
        <div className="flex items-end justify-between gap-3 flex-wrap border-b border-line pb-4">
          <div>
            <h2 className="font-display text-xl tracking-tight">Analytics</h2>
            <p className="text-[11px] text-ink-3 num mt-0.5">
              {rangeLabel} · across platforms
            </p>
          </div>
          <AnalyticsDateFilter from={from ?? null} to={to ?? null} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {tiles.map((t) => (
            <Card key={t.label} className="bg-surface border-line">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-[0.14em] text-ink-3 font-medium">
                  {t.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl num text-ink leading-none">
                  {t.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-surface border-line">
          <CardHeader>
            <CardTitle className="text-sm">Performance over time</CardTitle>
          </CardHeader>
          <CardContent>
            <CreativePerfLineChart rows={perfRows} />
          </CardContent>
        </Card>

        <div>
          <h3 className="text-sm font-medium text-ink mb-3">By platform</h3>
          <CreativePlatformTable rows={byPlatform} />
        </div>

        <div>
          <h3 className="text-sm font-medium text-ink mb-3">
            {from && to ? "Records in range" : "All records"}
          </h3>
          <CreativeRecordsTable rows={records} />
        </div>
      </section>

      {/* ─────────── Activity log ─────────── */}
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

      {/* ─────────── Danger zone ─────────── */}
      <div className="rounded-xl border border-neg/30 bg-neg/5 p-4 md:p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-medium text-ink">Delete this creative</h2>
            <p className="text-xs text-ink-3 mt-0.5 max-w-xl">
              Permanently removes the creative, its tags, and all{" "}
              {deletionSummary.records.toLocaleString()} of its performance
              records. This can&apos;t be undone and affects no other creative.
            </p>
          </div>
          <DeleteCreativeDialog
            creativeId={creative.id}
            creativeName={creative.name}
            summary={deletionSummary}
          />
        </div>
      </div>
    </div>
  );
}
