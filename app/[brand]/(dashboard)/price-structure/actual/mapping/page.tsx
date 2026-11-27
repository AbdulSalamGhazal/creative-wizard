import { requirePriceStructureAccess, VIEW_PERM } from "@/lib/price-structure-access";
import { refusable } from "@/lib/auth";
import { AccessRefused } from "@/components/layout/access-refused";
import { PageShell } from "@/components/layout/page-shell";
import {
  actualMappings,
  mappingAdProducts,
  mappingAdSpend,
  mappingSkus,
  RATE_WINDOW_DAYS,
} from "@/db/queries/price-structure-actual";
import { shiftIso, todayIso } from "@/lib/date-presets";
import { MappingView } from "@/components/price-structure/actual/mapping-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Pricing · SKU mapping" };

/**
 * Pricing · Actual → SKU mapping (2026-11-27). Per BRAND: which Pricing
 * product each Salla SKU sells and which offer each quantity is, and which
 * Pricing product each Library product's ad spend belongs to. Lists what the
 * last 90 days sold or spent, plus anything already mapped. Editing needs
 * `price_structure.edit`; the page is open to any Pricing grant.
 */
export default async function Page() {
  if (!(await refusable(() => requirePriceStructureAccess()))) {
    return <AccessRefused page="Pricing" perm={VIEW_PERM} />;
  }
  const to = todayIso();
  const from = shiftIso(to, -(RATE_WINDOW_DAYS - 1));
  const [skus, adProducts, adSpend, mappings] = [
    await mappingSkus(from, to),
    await mappingAdProducts(),
    await mappingAdSpend(from, to),
    await actualMappings(),
  ];
  return (
    <PageShell>
      <MappingView skus={skus} adProducts={adProducts} adSpend={adSpend} mappings={mappings} windowDays={RATE_WINDOW_DAYS} />
    </PageShell>
  );
}
