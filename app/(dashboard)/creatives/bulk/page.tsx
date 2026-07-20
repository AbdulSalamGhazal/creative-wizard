import { redirect } from "next/navigation";
import { listProducts } from "@/db/queries/products";
import { auth, can } from "@/lib/auth";
import { BulkCreativeImport } from "@/components/creative/bulk-creative-import";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Bulk add creatives" };

export default async function BulkCreativesPage() {
  const user = await auth();
  if (!user || !can(user, "creative.create")) redirect("/creatives");
  const products = await listProducts();

  return (
    <PageShell width="import">
      <PageHeader
        backLink={{ href: "/creatives", label: "Back to library" }}
        title="Bulk add creatives"
        subtitle="Rows are validated against your catalog — nothing is created unless every row is clean."
      />

      <BulkCreativeImport products={products.map((p) => p.name)} />
    </PageShell>
  );
}
