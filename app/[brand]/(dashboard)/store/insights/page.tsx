import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { listStoreFields } from "@/db/queries/store";
import {
  storeInsightsBreakdown,
  storeInsightsDaily,
  storeInsightsKpis,
  storeInsightsProducts,
  storeInsightsSections,
} from "@/db/queries/store-insights";
import { storeInsightsFiltersSchema } from "@/validators/store";
import { resolveFilterPrefs, resolvePreferredRange } from "@/db/queries/user-prefs";
import { defaultDateRange } from "@/lib/date-presets";
import { prevPeriod } from "@/lib/period";
import { insightDimensions, resolveDimension } from "@/lib/store-insights";
import { platformEnum } from "@/lib/enums";
import { CHANNEL_DESTINATIONS, UNMAPPED_CHANNEL } from "@/store/channels";
import { UNATTRIBUTED } from "@/store/sources";
import { StoreInsightsView } from "@/components/store/store-insights-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Store · Insights" };

type SearchParams = Record<string, string | string[] | undefined>;
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Store → Insights. What the orders alone can tell a marketer: the trend, the
 * headline tiles, then the decision sections (2026-11-27, user-chosen) —
 * products and margin, how customers pay and where orders end up, new vs
 * returning customers and cities, discounts and offers — and the curated
 * "Break down by" explorer.
 *
 * STORE FACTS ONLY, SAR ONLY (standing decision, 2026-09) — no spend, no ROAS,
 * no platform-claimed conversions. The previous-period comparison is a TOGGLE,
 * off by default (user decision 2026-11-27, superseding v1's "no comparison").
 *
 * Read-open to any brand member, like Orders.
 */
export default async function StoreInsightsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  // The dimension list is DERIVED from this brand's field config, so it is
  // needed before the preference for `?by=` can be validated against it.
  const fields = await listStoreFields();
  const dimensions = insightDimensions(fields);

  // REMEMBERED FILTERS (0049): URL → this user's saved value for this brand →
  // the page default, resolved server-side. `by` rides the same mechanism, so
  // the page reopens on the dimension you actually use; a field no longer
  // offered (deleted, or a personal one since 2026-11-27) is dropped by
  // `allow` and `resolveDimension` falls back.
  const pref = await resolveFilterPrefs(
    [
      { key: "platforms", allow: [...platformEnum, UNATTRIBUTED] },
      { key: "channels", allow: [...CHANNEL_DESTINATIONS, UNMAPPED_CHANNEL] },
      { key: "by", allow: dimensions.map((d) => d.key) },
    ],
    (key: string) => pick(sp[key]),
  );
  const f = storeInsightsFiltersSchema.parse({
    from: pick(sp.from),
    to: pick(sp.to),
    by: pref.by,
    platforms: pref.platforms,
    channels: pref.channels,
    compare: pick(sp.compare),
  });
  const dimension = resolveDimension(f.by, dimensions);

  // Resolved server-side — URL → the user's saved preferred range → last 30
  // days — and the SAME values feed every scan and the picker's label.
  const range = await resolvePreferredRange(f.from, f.to, defaultDateRange(30));
  const prev = f.compare ? prevPeriod(range.from, range.to) : null;

  const filters = { platforms: f.platforms, channels: f.channels };
  // Every scan carries the SAME range and filters — the tiles, the sections
  // and the breakdown describe one set of orders, or their shares lie.
  // `lib/db.ts` is `max: 1`, so these run one after another; the previous
  // window costs three more only when the toggle is on.
  const [daily, breakdown, kpis, sections, products, prevDaily, prevKpis, prevProducts] =
    await Promise.all([
      storeInsightsDaily(range.from, range.to, filters),
      dimension
        ? storeInsightsBreakdown(dimension.key, range.from, range.to, filters)
        : Promise.resolve({ rows: [], totalValues: 0 }),
      storeInsightsKpis(range.from, range.to, filters),
      storeInsightsSections(range.from, range.to, filters),
      storeInsightsProducts(range.from, range.to, filters),
      prev ? storeInsightsDaily(prev.from, prev.to, filters) : Promise.resolve(null),
      prev ? storeInsightsKpis(prev.from, prev.to, filters) : Promise.resolve(null),
      prev ? storeInsightsProducts(prev.from, prev.to, filters, 0) : Promise.resolve(null),
    ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Store"
        title="Insights"
        info="Store facts only, in SAR: no ad spend, no claimed conversions."
      />
      <StoreInsightsView
        from={f.from ?? null}
        to={f.to ?? null}
        resolvedRange={range}
        resolvedFilters={pref}
        dimensions={dimensions}
        dimension={dimension}
        daily={daily}
        breakdown={breakdown.rows}
        totalValues={breakdown.totalValues}
        kpis={kpis}
        sections={sections}
        products={products}
        compare={
          prev && prevDaily && prevKpis && prevProducts
            ? { range: prev, daily: prevDaily, kpis: prevKpis, productTotals: prevProducts.total }
            : null
        }
      />
    </PageShell>
  );
}
