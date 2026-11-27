import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import {
  brandHasStoreOrders,
  listStoreOrders,
  listStoreFields,
  storeOrderFilterOptions,
  storeOrderStageCounts,
} from "@/db/queries/store";
import { resolveStoreOrderFilters } from "@/lib/store-order-filters";
import { StoreOrderStageTabs } from "@/components/store/store-order-stage-tabs";
import { resolvePreferredRange } from "@/db/queries/user-prefs";
import { defaultDateRange } from "@/lib/date-presets";
import { StoreFilterBar } from "@/components/store/store-filter-bar";
import { StoreOrdersTable } from "@/components/store/store-orders-table";
import { resolveTablePrefs } from "@/db/queries/user-prefs";
import { TABLE_KEYS } from "@/lib/table-columns";
import { storeConnectionStatus } from "@/db/queries/store-connector";
import { StoreConnectionLine } from "@/components/store/store-connection-line";

export const dynamic = "force-dynamic";

export const metadata = { title: "Store · Orders" };

type SearchParams = Record<string, string | string[] | undefined>;
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Orders — the all-orders table for the Store module (SAR, brand-scoped). Date
 * picker, search (order + customer), status tabs with counts and the Filters
 * dialog (2026-11-27), server pagination, totals footer, CSV export, and
 * — for a brand linked to a Salla store — the feed's connection line. Open
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
  // URL → remembered → none, for the Filters dialog's keys (0049); the CSV
  // export resolves through the same function.
  const { f, pref } = await resolveStoreOrderFilters((k) => pick(sp[k]));

  // Resolved server-side — URL params → the user's saved preferred range →
  // last 7 days — and the SAME values feed the query and the picker. With the
  // raw optional params the query's `f.from && f.to` branch simply never bound,
  // so a fresh visit listed EVERY order ever while the picker said "Last 7
  // days". BEHAVIOUR CHANGE: a paramless visit now lists the resolved range,
  // and the count header, pagination and CSV all follow what's shown.
  const range = await resolvePreferredRange(f.from, f.to, defaultDateRange());

  const listed = { ...f, from: range.from, to: range.to };
  const [fields, orders, stageCounts, options, tablePrefs, connection] = await Promise.all([
    listStoreFields(),
    listStoreOrders(listed),
    // Every tab's count under the same range, search and filters.
    storeOrderStageCounts(listed),
    storeOrderFilterOptions(),
    // The viewer's remembered columns (2026-10) — per user per brand now,
    // where this used to be a localStorage set per browser.
    resolveTablePrefs([TABLE_KEYS.STORE_ORDERS]),
    // null for a brand with no Salla store linked — then nothing is drawn.
    storeConnectionStatus(),
  ]);
  // First use vs "the range/search hid them" (R-059) — asked only when the
  // listing is empty.
  const firstUse = orders.total === 0 && !(await brandHasStoreOrders());

  return (
    <PageShell>
      <PageHeader
        eyebrow="Store"
        title="Orders"
        info="Amounts are in SAR."
      >
        {connection && <StoreConnectionLine status={connection} />}
      </PageHeader>

      <div className="space-y-2">
        <StoreFilterBar
          from={f.from ?? null}
          to={f.to ?? null}
          resolvedRange={range}
          q={f.q ?? ""}
          resolvedFilters={pref}
          options={options}
        />
        <StoreOrderStageTabs stage={f.stage ?? null} counts={stageCounts} />
        <StoreOrdersTable
          rows={orders.rows}
          itemsByOrder={orders.itemsByOrder}
          fields={fields}
          total={orders.total}
          sumTotal={orders.sumTotal}
          page={orders.page}
          pageSize={orders.pageSize}
          sort={f.sort}
          dir={f.dir}
          canUpload={canUpload}
          firstUse={firstUse}
          showSource={connection !== null}
          columnPref={tablePrefs[TABLE_KEYS.STORE_ORDERS]}
        />
      </div>
    </PageShell>
  );
}
