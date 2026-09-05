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
  distinctStoreSourceValues,
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

  const user = await auth();
  const canConfig = user ? can(user, "config.store") : false;

  // Effective Excluded state for the ads side (URL param → saved pref → hidden).
  const includeExcluded = await resolveIncludeExcluded(pick(sp.includeExcluded));

  const sourceFieldKey = await getStoreSourceFieldKey();
  const [overview, byPlatform, horizons, mappings, values] = await Promise.all([
    reconciliationOverview(f.from, f.to, includeExcluded),
    reconciliationByPlatform(sourceFieldKey, f.from, f.to, includeExcluded),
    platformDataHorizons(),
    listStoreSourceMappings(),
    distinctStoreSourceValues(sourceFieldKey),
  ]);

  const mapped = new Set(mappings.map((m) => m.rawValue));
  const unmappedCount = values.filter((v) => !mapped.has(v.value)).length;

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
