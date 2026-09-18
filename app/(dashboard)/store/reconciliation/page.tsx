import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { platformEnum } from "@/db/schema";
import { reconciliationFiltersSchema } from "@/validators/store";
import {
  reconciliationOverview,
  reconciliationByPlatform,
  reconciliationByChannel,
  platformDataHorizons,
  type ReconPlatform,
} from "@/db/queries/reconciliation";
import { ReconciliationView } from "@/components/store/reconciliation-view";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { resolveIncludeExcluded, resolvePreferredRange } from "@/db/queries/user-prefs";
import { defaultDateRange } from "@/lib/date-presets";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reconciliation" };

function pick(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Store → Reconciliation. Compares store ORDER COUNTS vs platform-claimed
 * CONVERSIONS per day — counts only, never revenue. Read-open to any signed-in
 * user; the source mapping is configured in Upload orders → Order fields.
 */
export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const f = reconciliationFiltersSchema.parse({
    from: pick(sp.from),
    to: pick(sp.to),
  });

  // `lib/db.ts` holds ONE connection per instance, so these run serially
  // regardless — the point of batching is that nothing sits behind an await
  // it doesn't actually depend on. `includeExcluded` and the source field key
  // ARE inputs to the scans below, so they're resolved first, together.
  const user = await auth();
  const canConfig = user ? can(user, "config.store") : false;

  // Effective Excluded state for the ads side (URL param → saved pref → hidden).
  const includeExcluded = await resolveIncludeExcluded(pick(sp.includeExcluded));

  // The range is resolved HERE, server-side — URL params → the user's saved
  // preferred range → last 7 days — and the SAME values feed the queries and
  // the picker. Passing the raw optional params through would leave the
  // condition builders unbounded while the picker announced "Last 7 days":
  // aggregate numbers claiming a window they never ran. (A saved "lifetime"
  // preference decodes to the concrete floor→today range, which the picker
  // then honestly labels Lifetime.)
  const range = await resolvePreferredRange(f.from, f.to, defaultDateRange());

  const [overview, byPlatformResult, byChannelResult, horizons] = await Promise.all([
    reconciliationOverview(range.from, range.to, includeExcluded),
    // The source field is PINNED to utm_source — the picker is retired.
    reconciliationByPlatform(STORE_SOURCE_FIELD_KEY, range.from, range.to, includeExcluded),
    // ONE added scan: the claimed side of the Channels view is merged from the
    // overview rows above rather than re-queried.
    reconciliationByChannel(range.from, range.to),
    platformDataHorizons(),
  ]);
  const byPlatform = byPlatformResult.rows;

  // The unmapped-values banner reads the set the by-platform scan already
  // produced. It used to run a separate DISTINCT over every order the brand had
  // ever uploaded — unbounded, and only ever used to render a count.
  const unmappedCount = byPlatformResult.unmappedValues.length;
  const unmappedChannelCount = byChannelResult.unmappedValues.length;

  const horizonDays = Object.values(horizons).filter(Boolean) as string[];
  const maxHorizon = horizonDays.length
    ? horizonDays.reduce((a, b) => (a > b ? a : b))
    : null;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Store"
        title="Reconciliation"
        subtitle="Store order counts vs platform-claimed conversions, per day. Counts only — no revenue comparison. Δ positive = platforms claim more than the store recorded. Platform pixels largely see website purchases, so Δ excl. app is the honest attribution gap and Application explains the rest."
      />
      <ReconciliationView
        from={f.from ?? null}
        to={f.to ?? null}
        // What the queries actually ran — the picker's label comes from this
        // when the URL carries no explicit range.
        resolvedRange={range}
        includeExcluded={includeExcluded}
        overview={overview}
        byPlatform={byPlatform}
        byChannel={byChannelResult.rows}
        platforms={[...platformEnum] as ReconPlatform[]}
        sourceConfigured
        maxHorizon={maxHorizon}
        unmappedCount={unmappedCount}
        unmappedChannelCount={unmappedChannelCount}
        canConfig={canConfig}
      />
    </PageShell>
  );
}
