import { requirePriceStructureAccess } from "@/lib/price-structure-access";
import { versionNameFor } from "@/db/queries/price-structure";
import { PageShell } from "@/components/layout/page-shell";
import { ProductsView } from "@/components/price-structure/products/products-view";

export const dynamic = "force-dynamic";

type Params = Promise<{ path?: string[] }>;
type SearchParams = Promise<{ v?: string }>;

/** "Products & offers · {version}" so two tabs on two versions are told apart (brief §6.0). */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }) {
  const { v } = await searchParams;
  const name = await versionNameFor(v);
  return { title: name ? `Products & offers · ${name}` : "Products & offers" };
}

/** `/price-structure/products/:productId?/:offerId?` — the selection lives in the path. */
export default async function Page({ params }: { params: Params }) {
  await requirePriceStructureAccess();
  const { path = [] } = await params;
  return (
    <PageShell>
      <ProductsView productId={path[0] ?? null} offerId={path[1] ?? null} />
    </PageShell>
  );
}
