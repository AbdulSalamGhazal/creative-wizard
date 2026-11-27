import { requirePriceStructureAccess, VIEW_PERM } from "@/lib/price-structure-access";
import { refusable } from "@/lib/auth";
import { AccessRefused } from "@/components/layout/access-refused";
import { PageShell } from "@/components/layout/page-shell";
import { versionNameFor } from "@/db/queries/price-structure";
import { actualFacts, actualMappings, RATE_WINDOW_DAYS } from "@/db/queries/price-structure-actual";
import { resolvePreferredRange } from "@/db/queries/user-prefs";
import { defaultDateRange, shiftIso } from "@/lib/date-presets";
import { actualParamsSchema } from "@/validators/price-structure";
import { ActualView } from "@/components/price-structure/actual/actual-view";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** "Pricing · Actual · {version}" — the version names the plan the bridge compares with. */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }) {
  const name = await versionNameFor(pick((await searchParams).v));
  return { title: name ? `Pricing · Actual · ${name}` : "Pricing · Actual" };
}

/**
 * Pricing · Actual (2026-11-27): the REAL CML of a range — the Store's
 * orders, Product costs and the Ads uploads' spend — against the open
 * version's active plan. The store facts are read here (server, account-
 * scoped); the engine runs in the client view against the open version,
 * like every page of the module.
 */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  if (!(await refusable(() => requirePriceStructureAccess()))) {
    return <AccessRefused page="Pricing" perm={VIEW_PERM} />;
  }
  const sp = await searchParams;
  const f = actualParamsSchema.parse({ from: pick(sp.from), to: pick(sp.to) });
  // URL → the user's saved range → last 30 days, the same values feed the scans and the picker.
  const range = await resolvePreferredRange(f.from, f.to, defaultDateRange(30));
  const ratesFrom = shiftIso(range.to, -(RATE_WINDOW_DAYS - 1));
  const [facts, mappings] = [await actualFacts(range.from, range.to, ratesFrom), await actualMappings()];
  return (
    <PageShell>
      <ActualView facts={facts} mappings={mappings} from={f.from ?? null} to={f.to ?? null} resolvedRange={range} />
    </PageShell>
  );
}
