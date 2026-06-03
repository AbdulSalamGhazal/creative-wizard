import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  kpis,
  platformMix,
  productMix,
  spendByDatePlatform,
  tagMix,
  topCreatives,
  typeMix,
  type KpiFilters,
} from "@/db/queries/performance";
import { SpendOverTimeChart } from "@/components/charts/spend-over-time";
import { TopCreativesTable } from "@/components/charts/top-creatives";
import { PlatformMixDonut } from "@/components/charts/platform-mix";
import { ProductMixDonut } from "@/components/charts/product-mix";
import { MixDonut, type MixSlice } from "@/components/charts/mix-donut";
import { KpiTile } from "@/components/kpi/kpi-tile";
import {
  PLATFORM_COLOR,
  TYPE_COLOR,
  TYPE_LABEL,
  swatchColor,
} from "@/lib/palette";
import { usd, int, pct, ratio } from "@/lib/format";

type Platform = "instagram" | "facebook" | "tiktok" | "snapchat" | "google";

interface Props {
  title: string;
  /** Base filters from the URL (date / product / type / status / tag / excluded). */
  filters: KpiFilters;
  /** When set, the whole section is pinned to one platform; the platform-mix
   *  donut is omitted (it would be a single slice). */
  platform?: Platform;
  /** Caption under each KPI tile — the active window. */
  rangeLabel: string;
}

/**
 * One self-contained Overview block: KPI tiles → spend-over-time chart →
 * mix donuts → top creatives. Rendered once for "All platforms" and once
 * per platform (pinned) so the team can read the blended picture and then
 * each channel on its own, on a single page.
 */
export async function OverviewSection({
  title,
  filters,
  platform,
  rangeLabel,
}: Props) {
  const f: KpiFilters = platform
    ? { ...filters, platforms: [platform] }
    : filters;

  const [k, spendRows, topRows, platformMixRows, productMixRows, typeMixRows, tagMixRows] =
    await Promise.all([
      kpis(f),
      spendByDatePlatform(f),
      topCreatives(f, 10),
      // Platform-mix only makes sense in the blended section.
      platform ? Promise.resolve([]) : platformMix(f),
      productMix(f),
      typeMix(f),
      tagMix(f),
    ]);

  const tiles: Array<{ label: string; value: string; inverted?: boolean }> = [
    { label: "Spend", value: usd(k.spend) },
    { label: "Impressions", value: int(k.impressions) },
    { label: "Blended CTR", value: pct(k.ctr) },
    { label: "Conversions", value: int(k.conversions) },
    { label: "Blended CvR", value: pct(k.cvr) },
    { label: "Blended CPA", value: usd(k.cpa) },
    { label: "Blended ROAS", value: ratio(k.roas) },
  ];

  const typeSlices: MixSlice[] = typeMixRows.map((r) => ({
    key: r.type,
    label: TYPE_LABEL[r.type],
    value: r.spend,
    color: TYPE_COLOR[r.type],
  }));
  const tagSlices: MixSlice[] = tagMixRows.map((r) => ({
    key: r.tag,
    label: r.tag,
    value: r.spend,
    color: swatchColor(r.tag),
  }));

  return (
    <section className="space-y-4">
      {/* Section heading */}
      <div className="flex items-center gap-2.5 pt-2">
        {platform ? (
          <span
            className="w-2.5 h-2.5 rounded-sm shrink-0"
            style={{ background: PLATFORM_COLOR[platform] }}
            aria-hidden
          />
        ) : null}
        <h2 className="font-display text-2xl tracking-tight">{title}</h2>
        <span className="text-[11px] text-ink-3 num">{rangeLabel}</span>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
        {tiles.map((t) => (
          <KpiTile
            key={t.label}
            label={t.label}
            value={t.value}
            caption={rangeLabel}
          />
        ))}
      </div>

      {/* Spend over time */}
      <Card className="bg-surface border-line">
        <CardHeader>
          <CardTitle className="text-sm">Spend over time</CardTitle>
        </CardHeader>
        <CardContent>
          <SpendOverTimeChart rows={spendRows} />
        </CardContent>
      </Card>

      {/* Mix donuts: Platform (blended only) / Product / Type / Tag */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {!platform && (
          <Card className="bg-surface border-line">
            <CardHeader>
              <CardTitle className="text-sm">Platform mix</CardTitle>
            </CardHeader>
            <CardContent>
              <PlatformMixDonut rows={platformMixRows} />
            </CardContent>
          </Card>
        )}
        <Card className="bg-surface border-line">
          <CardHeader>
            <CardTitle className="text-sm">Product mix</CardTitle>
          </CardHeader>
          <CardContent>
            <ProductMixDonut rows={productMixRows} />
          </CardContent>
        </Card>
        <Card className="bg-surface border-line">
          <CardHeader>
            <CardTitle className="text-sm">Type mix</CardTitle>
          </CardHeader>
          <CardContent>
            <MixDonut slices={typeSlices} />
          </CardContent>
        </Card>
        <Card className="bg-surface border-line">
          <CardHeader>
            <CardTitle className="text-sm">Tag mix</CardTitle>
          </CardHeader>
          <CardContent>
            <MixDonut
              slices={tagSlices}
              emptyText="No tagged spend in this window."
            />
          </CardContent>
        </Card>
      </div>

      {/* Top creatives */}
      <Card className="bg-surface border-line">
        <CardHeader>
          <CardTitle className="text-sm">Top creatives by spend</CardTitle>
        </CardHeader>
        <CardContent>
          <TopCreativesTable rows={topRows} />
        </CardContent>
      </Card>
    </section>
  );
}
