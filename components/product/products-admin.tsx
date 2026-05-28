import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/db/schema";
import { ProductCreateForm } from "@/components/product/product-create-form";
import { ProductRowActions } from "@/components/product/product-row-actions";
import { countCreativesPerProduct } from "@/app/actions/product";
import { isoDate } from "@/lib/format";

/**
 * Products management section — the body of the former /admin/products page,
 * now hosted inside the merged Catalog tab. Every creative attaches to one
 * product; products with creatives can be archived but not deleted.
 */
export async function ProductsAdmin() {
  const [list, creativeCounts] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        status: products.status,
        createdAt: products.createdAt,
      })
      .from(products)
      .orderBy(asc(products.name)),
    countCreativesPerProduct(),
  ]);

  const active = list.filter((p) => p.status === "active");
  const archived = list.filter((p) => p.status === "archived");

  return (
    <div className="space-y-6">
      <p className="text-ink-2 text-sm">
        {active.length} active · {archived.length} archived. Every creative
        attaches to one product (PRD §5.2). Products with creatives can be
        archived but not deleted.
      </p>

      <div className="rounded-lg border border-line bg-surface p-4">
        <ProductCreateForm />
      </div>

      <ProductTable title="Active" rows={active} counts={creativeCounts} />
      {archived.length > 0 && (
        <ProductTable title="Archived" rows={archived} counts={creativeCounts} />
      )}
    </div>
  );
}

function ProductTable({
  title,
  rows,
  counts,
}: {
  title: string;
  rows: Array<{
    id: string;
    name: string;
    slug: string;
    status: "active" | "archived";
    createdAt: Date;
  }>;
  counts: Map<string, number>;
}) {
  if (rows.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-medium text-ink mb-2">{title}</h3>
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-8 text-center text-ink-3 text-xs">
          No products in this group.
        </div>
      </div>
    );
  }
  return (
    <div>
      <h3 className="text-sm font-medium text-ink mb-2">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm num">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
              <th className="font-medium px-3 py-2.5">Name</th>
              <th className="font-medium px-3 py-2.5">Slug</th>
              <th className="font-medium px-3 py-2.5 text-right">Creatives</th>
              <th className="font-medium px-3 py-2.5">Created</th>
              <th className="font-medium px-3 py-2.5 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr
                key={r.id}
                className={
                  r.status === "archived"
                    ? "opacity-70"
                    : "hover:bg-surface-2/60 transition-colors"
                }
              >
                <td className="px-3 py-2.5 text-ink">{r.name}</td>
                <td className="px-3 py-2.5 font-mono text-ink-2 text-[12px]">
                  {r.slug}
                </td>
                <td className="px-3 py-2.5 text-right text-ink-2">
                  {counts.get(r.id) ?? 0}
                </td>
                <td className="px-3 py-2.5 text-ink-3">{isoDate(r.createdAt)}</td>
                <td className="px-3 py-2.5 text-right">
                  <ProductRowActions productId={r.id} status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
