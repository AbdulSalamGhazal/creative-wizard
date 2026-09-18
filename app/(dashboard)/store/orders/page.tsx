import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { listStoreOrders, listStoreFields } from "@/db/queries/store";
import { storeOrdersFiltersSchema } from "@/validators/store";
import { resolvePreferredRange } from "@/db/queries/user-prefs";
import { defaultDateRange } from "@/lib/date-presets";
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

  // Resolved server-side — URL params → the user's saved preferred range →
  // last 7 days — and the SAME values feed the query and the picker. With the
  // raw optional params the query's `f.from && f.to` branch simply never bound,
  // so a fresh visit listed EVERY order ever while the picker said "Last 7
  // days". BEHAVIOUR CHANGE: a paramless visit now lists the resolved range,
  // and the count header, pagination and CSV all follow what's shown.
  const range = await resolvePreferredRange(f.from, f.to, defaultDateRange());

  const [fields, orders] = await Promise.all([
    listStoreFields(),
    listStoreOrders({ ...f, from: range.from, to: range.to }),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Store"
        title="Orders"
        subtitle="Every Salla order, filterable by date and order ID. Amounts are in SAR."
      />

      <div className="space-y-2">
        <StoreFilterBar
          from={f.from ?? null}
          to={f.to ?? null}
          resolvedRange={range}
          q={f.q ?? ""}
        />
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
