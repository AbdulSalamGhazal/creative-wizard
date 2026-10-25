import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { storeUtmsFiltersSchema } from "@/validators/store";
import { resolveIncludeExcluded, resolvePreferredRange } from "@/db/queries/user-prefs";
import { defaultDateRange } from "@/lib/date-presets";
import { listStoreFields } from "@/db/queries/store";
import { STORE_SOURCE_FIELD_KEY, SYSTEM_REQUIRED_FIELDS } from "@/store/fields";
import {
  utmClaimedDaily,
  utmDailyByBucket,
  utmSourceBreakdown,
  utmSourceDaily,
} from "@/db/queries/store-utms";
import { platformDataHorizons } from "@/db/queries/reconciliation";
import { TOP_SOURCE_SERIES } from "@/lib/store-utms";
import { StoreUtmsView } from "@/components/store/utms/store-utms-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "UTMs" };

type SearchParams = Record<string, string | string[] | undefined>;
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Store → UTMs. Where orders come from by `utm_source`, how well they are
 * tagged, and how each platform's claimed conversions compare with the orders
 * its UTMs actually show — COUNTS ONLY on that comparison, like
 * Reconciliation, and bucketed exactly as Reconciliation buckets (the two
 * pages can never disagree about a platform's gap). Read-open to any brand
 * member, like Insights; mapping an unmapped value inline needs
 * `config.store`.
 */
export default async function StoreUtmsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const f = storeUtmsFiltersSchema.parse({ from: pick(sp.from), to: pick(sp.to) });

  // Inputs to the scans first: who is asking (inline mapping), the ads side's
  // Excluded state, and the range — resolved SERVER-side (URL → the user's
  // saved range → last 30 days, like Insights) so the picker's label and the
  // queries' bounds are one value.
  const user = await auth();
  const canConfig = user ? can(user, "config.store") : false;
  const includeExcluded = await resolveIncludeExcluded(pick(sp.includeExcluded));
  const range = await resolvePreferredRange(f.from, f.to, defaultDateRange(30));

  // The blank bucket is named from the field's own label ("No UTM source"),
  // which a brand may have renamed.
  const fields = await listStoreFields();
  const sourceFieldLabel =
    fields.find((x) => x.key === STORE_SOURCE_FIELD_KEY)?.label ??
    SYSTEM_REQUIRED_FIELDS.find((x) => x.key === STORE_SOURCE_FIELD_KEY)!.label;

  const [daily, breakdown, claimed, horizons] = await Promise.all([
    utmDailyByBucket(range.from, range.to),
    utmSourceBreakdown(range.from, range.to),
    utmClaimedDaily(range.from, range.to, includeExcluded),
    platformDataHorizons(),
  ]);

  // The per-day series for the top N sources only (the breakdown is already
  // ordered by orders) — bounded by N × days, never by the long tail. The
  // blank bucket rides along so its trend can be read and compared too.
  const topValues = breakdown.rows.slice(0, TOP_SOURCE_SERIES).map((r) => r.value);
  const sourceDaily = await utmSourceDaily(range.from, range.to, topValues);

  const horizonDays = Object.values(horizons).filter(Boolean) as string[];
  const maxHorizon = horizonDays.length
    ? horizonDays.reduce((a, b) => (a > b ? a : b))
    : null;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Store"
        title="UTMs"
        info="Platform accuracy compares counts only: a platform's claimed conversions against the store orders whose UTM source maps to it. Store revenue is SAR and platform value is USD, so no revenue is compared."
      />
      <StoreUtmsView
        from={f.from ?? null}
        to={f.to ?? null}
        resolvedRange={range}
        includeExcluded={includeExcluded}
        sourceFieldLabel={sourceFieldLabel}
        daily={daily}
        breakdown={breakdown.rows}
        totalValues={breakdown.totalValues}
        sourceDaily={sourceDaily}
        claimed={claimed}
        maxHorizon={maxHorizon}
        canConfig={canConfig}
      />
    </PageShell>
  );
}
