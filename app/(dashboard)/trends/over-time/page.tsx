import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  kpisWithDelta,
  spendByDateComparison,
  topMovers,
  type KpiFilters,
} from "@/db/queries/performance";
import { readRememberedRange } from "@/lib/date-range-cookie";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { KpiTile } from "@/components/kpi/kpi-tile";
import { SpendComparisonChart } from "@/components/charts/spend-comparison";
import { TopMoversTable } from "@/components/trends/top-movers-table";
import { dashboardFiltersSchema } from "@/validators/filters";
import { usd, int, pct, ratio } from "@/lib/format";
import { periodCaption } from "@/lib/period";

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function TrendsOverTimePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const parsed = dashboardFiltersSchema.parse({
    from: pickFirst(params.from),
    to: pickFirst(params.to),
    productIds: pickFirst(params.productIds),
    platforms: pickFirst(params.platforms),
    types: pickFirst(params.types),
    tags: pickFirst(params.tags),
    includeExcluded: pickFirst(params.includeExcluded),
  });

  const defaultRange = await readRememberedRange();
  const from = parsed.from ?? defaultRange.from;
  const to = parsed.to ?? defaultRange.to;

  const filters: KpiFilters & { from: string; to: string } = {
    from,
    to,
    productIds: parsed.productIds,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    types: parsed.types.length > 0 ? parsed.types : undefined,
    tags: parsed.tags.length > 0 ? parsed.tags : undefined,
    includeExcluded: parsed.includeExcluded,
  };

  const [k, compareRows, movers, products, tags] = await Promise.all([
    kpisWithDelta(filters),
    spendByDateComparison(filters),
    topMovers(filters, 10),
    listProducts(),
    listAllTags(),
  ]);

  const caption = periodCaption(from, to);
  const platformsBadge =
    parsed.platforms.length > 0 ? parsed.platforms.join(", ") : "all platforms";

  // Tile config — `inverted: true` flips delta colors so that ↓ CPA reads as
  // green ("got cheaper"). Same for CPM/CPC.
  const tiles: Array<{
    label: string;
    value: string;
    delta: typeof k.delta.spend;
    inverted?: boolean;
  }> = [
    { label: "Spend", value: usd(k.current.spend), delta: k.delta.spend },
    { label: "Impressions", value: int(k.current.impressions), delta: k.delta.impressions },
    { label: "Blended CTR", value: pct(k.current.ctr), delta: k.delta.ctr },
    { label: "Conversions", value: int(k.current.conversions), delta: k.delta.conversions },
    { label: "Blended CvR", value: pct(k.current.cvr), delta: k.delta.cvr },
    { label: "Blended CPA", value: usd(k.current.cpa), delta: k.delta.cpa, inverted: true },
    { label: "Blended ROAS", value: ratio(k.current.roas), delta: k.delta.roas },
  ];

  return (
    <div className="space-y-6">
      <Suspense
        fallback={
          <div className="-mx-6 px-6 h-12 border-b border-line bg-background/95 backdrop-blur" />
        }
      >
        <div className="-mx-6 -mt-6 mb-2">
          <FilterStrip
            products={products}
            tags={tags}
            defaultFrom={from}
            defaultTo={to}
          />
        </div>
      </Suspense>

      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/trends"
            className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink transition-colors mb-2"
          >
            <ArrowLeft className="w-3 h-3" />
            Trends
          </Link>
          <h1 className="font-display text-4xl tracking-tight">Over time</h1>
          <p className="text-ink-2 text-sm mt-1">
            Every KPI compared to the immediately prior window of equal length.{" "}
            <span className="text-ink-3">{caption}</span> ·{" "}
            <span className="text-ink-3 font-mono text-[12px]">
              {k.prevRange.from} → {k.prevRange.to}
            </span>
          </p>
        </div>
        <Badge variant="outline" className="text-ink-3">
          {from} → {to} · {platformsBadge}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
        {tiles.map((t) => (
          <KpiTile
            key={t.label}
            label={t.label}
            value={t.value}
            delta={t.delta}
            inverted={t.inverted}
            caption={caption}
          />
        ))}
      </div>

      <Card className="bg-surface border-line">
        <CardHeader>
          <CardTitle className="text-sm">
            Daily spend — current vs prior window
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SpendComparisonChart rows={compareRows} />
        </CardContent>
      </Card>

      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-medium text-ink">Top movers</h2>
          <span className="text-[11px] text-ink-3">
            Sorted by absolute spend swing.
          </span>
        </div>
        <TopMoversTable rows={movers} />
      </div>
    </div>
  );
}
