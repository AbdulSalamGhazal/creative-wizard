import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { platformEnum } from "@/db/schema";
import { reconciliationFiltersSchema } from "@/validators/store";
import {
  reconciliationOverview,
  reconciliationByPlatform,
  getStoreSourceFieldKey,
  listStoreSourceMappings,
  platformDataHorizons,
  type ReconPlatform,
} from "@/db/queries/reconciliation";
import { ReconciliationView } from "@/components/store/reconciliation-view";
import { resolveIncludeExcluded } from "@/db/queries/user-prefs";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reconciliation" };

function pick(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Store → Reconciliation. Compares store ORDER COUNTS vs platform-claimed
 * CONVERSIONS per day — counts only, never revenue. Read-open to any signed-in
 * user; the source mapping is configured in Configuration → Store.
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

  const [includeExcluded, sourceFieldKey] = await Promise.all([
    // Effective Excluded state for the ads side (URL param → saved pref → hidden).
    resolveIncludeExcluded(pick(sp.includeExcluded)),
    getStoreSourceFieldKey(),
  ]);

  const [overview, byPlatformResult, horizons] = await Promise.all([
    reconciliationOverview(f.from, f.to, includeExcluded),
    reconciliationByPlatform(sourceFieldKey, f.from, f.to, includeExcluded),
    platformDataHorizons(),
  ]);
  const byPlatform = byPlatformResult.rows;

  // The unmapped-values banner reads the set the by-platform scan already
  // produced. It used to run a separate DISTINCT over every order the brand had
  // ever uploaded — unbounded, and only ever used to render a count.
  const unmappedCount = byPlatformResult.unmappedValues.length;

  const horizonDays = Object.values(horizons).filter(Boolean) as string[];
  const maxHorizon = horizonDays.length
    ? horizonDays.reduce((a, b) => (a > b ? a : b))
    : null;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Store"
        title="Reconciliation"
        subtitle="Store order counts vs platform-claimed conversions, per day. Counts only — no revenue comparison."
      />
      <ReconciliationView
        from={f.from ?? null}
        to={f.to ?? null}
        includeExcluded={includeExcluded}
        overview={overview}
        byPlatform={byPlatform}
        platforms={[...platformEnum] as ReconPlatform[]}
        sourceConfigured={sourceFieldKey !== null}
        maxHorizon={maxHorizon}
        unmappedCount={unmappedCount}
        canConfig={canConfig}
      />
    </PageShell>
  );
}
