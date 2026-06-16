import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listProducts } from "@/db/queries/products";
import { BulkCreativeImport } from "@/components/creative/bulk-creative-import";

export const dynamic = "force-dynamic";

export default async function BulkCreativesPage() {
  const products = await listProducts();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link
          href="/creatives"
          className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to library
        </Link>
        <h1 className="font-display text-4xl tracking-tight mt-2">Bulk add creatives</h1>
        <p className="text-ink-2 text-sm mt-1">
          Rows are validated against your catalog — nothing is created unless
          every row is clean.
        </p>
      </div>

      <BulkCreativeImport products={products.map((p) => p.name)} />
    </div>
  );
}
