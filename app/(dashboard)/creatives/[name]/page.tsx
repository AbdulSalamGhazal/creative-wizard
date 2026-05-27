import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  kpis,
  platformMix,
  spendByDatePlatform,
} from "@/db/queries/performance";
import { creativeRecords, getCreativeByName } from "@/db/queries/creatives";
import { CreativeDetailHeader } from "@/components/creative/creative-detail-header";
import { CreativePerfLineChart } from "@/components/charts/creative-perf-line";
import { CreativePlatformTable } from "@/components/creative/creative-platform-table";
import { CreativeRecordsTable } from "@/components/creative/creative-records-table";
import { NotesPanel } from "@/components/creative/notes-panel";
import { int, pct, ratio, usd } from "@/lib/format";

export default async function CreativeDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  const creative = await getCreativeByName(decoded);
  if (!creative) {
    notFound();
  }

  const [k, byPlatform, perfRows, records] = await Promise.all([
    kpis({ creativeIds: [creative.id] }),
    platformMix({ creativeIds: [creative.id] }),
    spendByDatePlatform({ creativeIds: [creative.id] }),
    creativeRecords(creative.id),
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
    <div className="space-y-8">
      <CreativeDetailHeader creative={creative} />

      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-2">
          All-time performance · across platforms
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
        <h2 className="text-sm font-medium text-ink mb-3">By platform</h2>
        <CreativePlatformTable rows={byPlatform} />
      </div>

      <NotesPanel creativeId={creative.id} initialNotes={creative.notes} />

      <div>
        <h2 className="text-sm font-medium text-ink mb-3">All records</h2>
        <CreativeRecordsTable rows={records} />
      </div>
    </div>
  );
}
