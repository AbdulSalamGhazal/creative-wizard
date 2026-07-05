import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { defaultDateRange } from "@/lib/date-presets";
import { resolvePreferredRange } from "@/db/queries/user-prefs";
import { typeRollup, type TypeRollupRow } from "@/db/queries/trends";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { TypePlatformChart } from "@/components/trends/type-platform-chart";
import { TypeRollupTable } from "@/components/trends/type-rollup-table";
import { dashboardFiltersSchema } from "@/validators/filters";
import { TYPE_COLOR, TYPE_LABEL } from "@/lib/palette";
import { pct, ratio, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

const TRAILING_DAYS_DEFAULT = 30;
const TYPE_ORDER: Array<TypeRollupRow["type"]> = ["video", "image", "slides"];

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function TrendsByTypePage({
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
    includeExcluded: pickFirst(params.includeExcluded),
  });

  const range = await resolvePreferredRange(
    pickFirst(params.from),
    pickFirst(params.to),
    defaultDateRange(TRAILING_DAYS_DEFAULT),
  );
  const from = range.from;
  const to = range.to;
  const filters = {
    from,
    to,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
    includeExcluded: parsed.includeExcluded,
  };

  const [byType, byTypePlatform, products, tags] = await Promise.all([
    typeRollup(filters, { byPlatform: false }),
    typeRollup(filters, { byPlatform: true }),
    listProducts(),
    listAllTags(),
  ]);

  const totalSpend = byType.reduce((s, r) => s + r.spend, 0);

  return (
    <PageShell
      filterStrip={
        <FilterStrip
          products={products}
          tags={tags}
          defaultFrom={from}
          defaultTo={to}
        />
      }
    >
      <PageHeader
        backLink={{ href: "/trends", label: "Trends" }}
        title="Types"
        rightSlot={
          <Badge variant="outline" className="text-ink-3">
            {from} → {to}
          </Badge>
        }
      />

      {/* Blended totals per format */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {TYPE_ORDER.map((type) => {
          const r = byType.find((x) => x.type === type);
          const spend = r?.spend ?? 0;
          const share = totalSpend > 0 ? spend / totalSpend : 0;
          return (
            <div key={type} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ background: TYPE_COLOR[type] }}
                />
                <span className="text-sm text-ink-2">{TYPE_LABEL[type]}</span>
                <span className="ml-auto text-[11px] text-ink-3 tabular-nums">
                  {pct(share)} of spend
                </span>
              </div>
              <div className="font-display text-2xl text-ink num leading-none">
                {usd(spend)}
              </div>
              <div className="mt-2 flex items-center gap-4 text-[11px] text-ink-3">
                <span>
                  ROAS{" "}
                  <span className="text-ink-2 tabular-nums">
                    {r?.roas == null ? "—" : `${ratio(r.roas)}×`}
                  </span>
                </span>
                <span>
                  CTR{" "}
                  <span className="text-ink-2 tabular-nums">{pct(r?.ctr ?? null)}</span>
                </span>
                <span>
                  Creatives{" "}
                  <span className="text-ink-2 tabular-nums">{r?.creatives ?? 0}</span>
                </span>
              </div>
              <div className="mt-2.5 h-1 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${share * 100}%`, background: TYPE_COLOR[type] }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Platform → type chart */}
      <TypePlatformChart rows={byTypePlatform} />

      {/* Platform → type table */}
      <div className="space-y-2">
        <h2 className="text-label text-ink-3">
          Breakdown · platform → type
        </h2>
        <TypeRollupTable rows={byTypePlatform} byPlatform />
      </div>
    </PageShell>
  );
}
