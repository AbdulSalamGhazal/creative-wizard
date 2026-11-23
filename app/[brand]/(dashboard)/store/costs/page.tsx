import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { listStoreProductCosts, listStoreProducts } from "@/db/queries/store-costs";
import { resolveTablePrefs } from "@/db/queries/user-prefs";
import { TABLE_KEYS } from "@/lib/table-columns";
import { todayIso } from "@/lib/date-presets";
import { ProductCostsView } from "@/components/store/product-costs-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Store · Product costs" };

/**
 * Store → Product costs (2026-11-23): what each product costs the brand, per
 * unit, from a day — the input to COGS and gross profit on the order panel and
 * the MCP. Lists every product the brand's Salla orders carried (SKU, or name
 * when Salla sent none). Read-open to any brand member; editing needs
 * `config.store`, like Order fields.
 */
export default async function StoreProductCostsPage() {
  const user = await auth();
  const canEdit = user ? can(user, "config.store") : false;
  const today = todayIso();
  const [products, costs, tablePrefs] = await Promise.all([
    listStoreProducts(today),
    listStoreProductCosts(),
    resolveTablePrefs([TABLE_KEYS.STORE_PRODUCT_COSTS]),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Store"
        title="Product costs"
        info="Unit cost per product, in SAR. A cost applies to orders from its date until a newer one."
      />
      <ProductCostsView
        products={products}
        costs={costs}
        today={today}
        canEdit={canEdit}
        columnPref={tablePrefs[TABLE_KEYS.STORE_PRODUCT_COSTS]}
      />
    </PageShell>
  );
}
