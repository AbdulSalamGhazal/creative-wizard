import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { listStoreOrders, listStoreFields } from "@/db/queries/store";
import { storeOrdersFiltersSchema } from "@/validators/store";
import { StoreFilterBar } from "@/components/store/store-filter-bar";
import { StoreOrdersTable } from "@/components/store/store-orders-table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Orders" };

type SearchParams = Record<string, string | string[] | undefined>;
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Orders — the all-orders table for the Store module (SAR, brand-scoped). Date
 * picker + order-id search, server pagination, totals footer, CSV export. Open
 * to any brand member (read is open, like the ads data pages). Uploading orders
 * lives on /store/uploads.
 */
export default async function StoreOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await auth();
  const canUpload = user ? can(user, "store.upload") : false;

  const sp = await searchParams;
  const f = storeOrdersFiltersSchema.parse({
    from: pick(sp.from),
    to: pick(sp.to),
    q: pick(sp.q),
    page: pick(sp.page),
    sort: pick(sp.sort),
    dir: pick(sp.dir),
  });

  const [fields, orders] = await Promise.all([
    listStoreFields(),
    listStoreOrders(f),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Store"
        title="Orders"
        subtitle="Every Salla order, filterable by date and order ID. Amounts are in SAR."
      />

      <div className="space-y-2">
        <StoreFilterBar from={f.from ?? null} to={f.to ?? null} q={f.q ?? ""} />
        <StoreOrdersTable
          rows={orders.rows}
          fields={fields}
          total={orders.total}
          sumTotal={orders.sumTotal}
          page={orders.page}
          pageSize={orders.pageSize}
          sort={f.sort}
          dir={f.dir}
          canUpload={canUpload}
        />
      </div>
    </PageShell>
  );
}
