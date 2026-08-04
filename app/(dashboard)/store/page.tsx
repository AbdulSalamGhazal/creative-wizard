import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import {
  listStoreOrders,
  listStoreFields,
  listStoreBatches,
} from "@/db/queries/store";
import { storeOrdersFiltersSchema } from "@/validators/store";
import { StoreUploadPanel } from "@/components/store/store-upload-panel";
import { RecentStoreBatches } from "@/components/store/recent-store-batches";
import { StoreFilterBar } from "@/components/store/store-filter-bar";
import { StoreOrdersTable } from "@/components/store/store-orders-table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Store" };

type SearchParams = Record<string, string | string[] | undefined>;
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Store — manual Salla order uploads (top) + the orders table (below). All data
 * is SAR and brand-scoped. Upload/rollback gate on `store.upload`; the table is
 * open to any brand member (read is open, like the other data pages).
 */
export default async function StorePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await auth();
  const canUpload = user ? can(user, "store.upload") : false;
  const canRollback = user ? can(user, "upload.rollback") : false;

  const sp = await searchParams;
  const f = storeOrdersFiltersSchema.parse({
    from: pick(sp.from),
    to: pick(sp.to),
    q: pick(sp.q),
    page: pick(sp.page),
    sort: pick(sp.sort),
    dir: pick(sp.dir),
  });

  const [fields, orders, batches] = await Promise.all([
    listStoreFields(),
    listStoreOrders(f),
    listStoreBatches(10),
  ]);

  return (
    <PageShell>
      <PageHeader
        title="Store"
        subtitle="Upload your Salla order exports, then browse and filter every order. Amounts are in SAR."
      />

      {canUpload && (
        <>
          <StoreUploadPanel />
          {batches.length > 0 && (
            <RecentStoreBatches
              batches={batches.map((b) => ({
                id: b.id,
                fileName: b.fileName,
                uploadedByName: b.uploadedByName,
                uploadedAt: b.uploadedAt.toISOString(),
                rowsInserted: b.rowsInserted,
                rowsUpdated: b.rowsUpdated,
                upsert: b.upsert,
                status: b.status,
              }))}
              canRollback={canRollback}
            />
          )}
        </>
      )}

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
