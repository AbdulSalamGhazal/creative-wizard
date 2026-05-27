import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const kpis = [
  { label: "Spend", value: "—", hint: "Awaiting first upload" },
  { label: "Impressions", value: "—", hint: "Awaiting first upload" },
  { label: "Blended CTR", value: "—", hint: "Awaiting first upload" },
  { label: "Conversions", value: "—", hint: "Awaiting first upload" },
  { label: "Blended CPA", value: "—", hint: "Awaiting first upload" },
  { label: "Blended ROAS", value: "—", hint: "Awaiting first upload" },
];

export default function OverviewPage() {
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
          Scaffold preview — data layer not wired yet
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map((k) => (
          <Card key={k.label} className="bg-surface border-line">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-[0.14em] text-ink-3 font-medium">
                {k.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-display text-4xl num text-ink leading-none">
                {k.value}
              </div>
              <div className="text-[11px] text-ink-3 mt-2">{k.hint}</div>
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
              Stacked-area chart by platform (Recharts) — pending data
            </div>
          </CardContent>
        </Card>
        <Card className="bg-surface border-line">
          <CardHeader>
            <CardTitle className="text-sm">Platform mix</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
              Donut — pending data
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
            TanStack Table with sparklines — pending data
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
