import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { listStoreFields } from "@/db/queries/store";
import {
  storeInsightsBreakdown,
  storeInsightsDaily,
} from "@/db/queries/store-insights";
import { storeInsightsFiltersSchema } from "@/validators/store";
import { resolveFilterPrefs, resolvePreferredRange } from "@/db/queries/user-prefs";
import { defaultDateRange } from "@/lib/date-presets";
import { insightDimensions, resolveDimension } from "@/lib/store-insights";
import { platformEnum } from "@/db/schema";
import { CHANNEL_DESTINATIONS, UNMAPPED_CHANNEL } from "@/store/channels";
import { UNATTRIBUTED } from "@/store/sources";
import { StoreInsightsView } from "@/components/store/store-insights-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Insights" };

type SearchParams = Record<string, string | string[] | undefined>;
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Store → Insights. An analytical read over the orders themselves: how many,
 * for how much, and broken down by whichever field or mapped lens you choose.
 *
 * STORE FACTS ONLY, SAR ONLY (standing decision, 2026-09) — no spend, no ROAS,
 * no platform-claimed conversions. Reconciliation owns claimed-vs-store and
 * Budget owns the money plans; this page answers questions the orders can
 * answer alone. NO period comparison in v1 (user decision): the selected range
 * only, so nothing on the page can imply a trend it didn't measure.
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
  // the page reopens on the dimension you actually use; a deleted field's
  // remembered value is dropped by `allow` and `resolveDimension` falls back.
  const pref = await resolveFilterPrefs(
    [
      { key: "platforms", allow: [...platformEnum, UNATTRIBUTED] },
      { key: "channels", allow: [...CHANNEL_DESTINATIONS, UNMAPPED_CHANNEL] },
      { key: "by", allow: dimensions.map((d) => d.key) },
    ],
    (key: string) => pick(sp[key]),
  );
  // The validator sees the RESOLVED values, exactly where the raw params went
  // before — unknown parts (a retired platform, a stale remembered value) are
  // dropped, never an error.
  const f = storeInsightsFiltersSchema.parse({
    from: pick(sp.from),
    to: pick(sp.to),
    by: pref.by,
    platforms: pref.platforms,
    channels: pref.channels,
  });
  const dimension = resolveDimension(f.by, dimensions);

  // Resolved server-side — URL → the user's saved preferred range → last 30
  // days — and the SAME values feed both scans and the picker's label. Raw
  // optional params would leave the conditions unbound while the control
  // announced a window the queries never ran.
  const range = await resolvePreferredRange(f.from, f.to, defaultDateRange(30));

  const filters = { platforms: f.platforms, channels: f.channels };
  // TWO scans, both bounded by the range and both carrying the same filters —
  // the shares would lie if the trend and the breakdown described different
  // sets of orders. The KPIs are summed from the daily rows in JS.
  const [daily, breakdown] = await Promise.all([
    storeInsightsDaily(range.from, range.to, filters),
    dimension
      ? storeInsightsBreakdown(dimension.key, range.from, range.to, filters)
      : Promise.resolve({ rows: [], totalValues: 0 }),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Store"
        title="Insights"
        subtitle="What the orders themselves say — volume, revenue and average order value over the range, and the breakdown behind them. Store facts only, in SAR: no ad spend, no claimed conversions."
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
      />
    </PageShell>
  );
}
