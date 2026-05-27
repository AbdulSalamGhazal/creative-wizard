import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { kpis, defaultDateRange } from "@/db/queries/performance";
import { usd, int, pct, ratio } from "@/lib/format";

const TRAILING_DAYS = 30;

export default async function OverviewPage() {
  const range = defaultDateRange(TRAILING_DAYS);
  const k = await kpis({ from: range.from, to: range.to });

  const tiles: Array<{ label: string; value: string }> = [
    { label: "Spend", value: usd(k.spend) },
    { label: "Impressions", value: int(k.impressions) },
    { label: "Blended CTR", value: pct(k.ctr) },
    { label: "Conversions", value: int(k.conversions) },
    { label: "Blended CPA", value: usd(k.cpa) },
    { label: "Blended ROAS", value: ratio(k.roas) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Overview</h1>
          <p className="text-ink-2 text-sm mt-1">
            Aggregated performance across products, platforms, and creatives.
          </p>
        </div>
        <Badge variant="outline" className="text-ink-3">
          {range.from} → {range.to} · excluded hidden
        </Badge>
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
              <div className="font-display text-4xl num text-ink leading-none">
                {t.value}
              </div>
              <div className="text-[11px] text-ink-3 mt-2">
                Trailing {TRAILING_DAYS} days
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 bg-surface border-line">
          <CardHeader>
            <CardTitle className="text-sm">Spend over time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
              Stacked-area chart by platform (Recharts) — pending implementation
            </div>
          </CardContent>
        </Card>
        <Card className="bg-surface border-line">
          <CardHeader>
            <CardTitle className="text-sm">Platform mix</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
              Donut — pending implementation
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-surface border-line">
        <CardHeader>
          <CardTitle className="text-sm">Top creatives by spend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
            TanStack Table with sparklines — pending implementation
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
