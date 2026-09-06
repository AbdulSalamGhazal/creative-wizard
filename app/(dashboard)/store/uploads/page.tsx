import Link from "next/link";
import { Plus, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { auth, can } from "@/lib/auth";
import { listStoreBatches } from "@/db/queries/store";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { PageTabs, type PageTab } from "@/components/layout/page-tabs";
import { StoreFieldsAdmin } from "@/components/store/store-fields-admin";
import { StoreSourceMappingAdmin } from "@/components/store/store-source-mapping-admin";
import { listStoreFields } from "@/db/queries/store";
import {
  getStoreSourceFieldKey,
  listStoreSourceMappings,
  distinctStoreSourceValues,
} from "@/db/queries/reconciliation";
import { RecentStoreBatches } from "@/components/store/recent-store-batches";
import { StoreCleanupTool } from "@/components/store/store-cleanup-tool";

export const dynamic = "force-dynamic";

export const metadata = { title: "Store uploads" };

/**
 * Order uploads — the store upload HISTORY (batches: file, when, by, counts,
 * upsert, rollback while eligible). Mirrors the ads /uploads page. The upload
 * flow itself lives on /store/uploads/new. Gated by `store.upload` /
 * `upload.rollback` (the nav item is too).
 */
const TAB_HISTORY = "history";
const TAB_FIELDS = "fields";

export default async function StoreUploadsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await auth();
  const canUpload = user ? can(user, "store.upload") : false;
  const canRollback = user ? can(user, "upload.rollback") : false;
  const canCleanup = user ? can(user, "store.cleanup") : false;
  const canFields = user ? can(user, "config.store") : false;

  const tabs: PageTab[] = [
    { key: TAB_HISTORY, label: "History", href: "/store/uploads" },
    ...(canFields
      ? [{ key: TAB_FIELDS, label: "Order fields", href: `/store/uploads?tab=${TAB_FIELDS}` }]
      : []),
  ];
  const { tab } = await searchParams;
  const activeTab = canFields && tab === TAB_FIELDS ? TAB_FIELDS : TAB_HISTORY;

  if (activeTab === TAB_FIELDS) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Store"
          title="Order fields"
          subtitle="The fields an order export can carry, and which raw source values map to which ad platform for Reconciliation."
        />
        <PageTabs tabs={tabs} active={activeTab} />
        <OrderFieldsTab />
      </PageShell>
    );
  }

  const batches = await listStoreBatches(50);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Store"
        title="Order uploads"
        subtitle={`${batches.length} ${batches.length === 1 ? "batch" : "batches"}.`}
        rightSlot={
          canUpload ? (
            <Button asChild>
              <Link href="/store/uploads/new">
                <Plus className="w-4 h-4" />
                New upload
              </Link>
            </Button>
          ) : undefined
        }
      />

      <PageTabs tabs={tabs} active={activeTab} />

      {batches.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface-2">
            <FileUp className="h-5 w-5 text-ink-2" />
          </div>
          <p className="mt-4 text-sm text-ink-2">No uploads yet.</p>
          <p className="mt-1 text-xs text-ink-3">
            Upload a Salla order export to get started.
          </p>
          {canUpload && (
            <div className="mt-4">
              <Button asChild>
                <Link href="/store/uploads/new">Upload your first export</Link>
              </Button>
            </div>
          )}
        </div>
      ) : (
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

      {(canRollback || canCleanup) && batches.length > 0 && (
        <p className="text-[11px] text-ink-3">
          Roll back a batch within 24 h of upload. Beyond that window, use the
          cleanup tool below to remove orders by date, batch, or ID.
        </p>
      )}

      {canCleanup && (
        <StoreCleanupTool
          batches={batches.map((b) => ({
            id: b.id,
            fileName: b.fileName,
            uploadedAt: b.uploadedAt.toISOString(),
          }))}
        />
      )}
    </PageShell>
  );
}

/**
 * Field config + the Reconciliation source mapping — moved here from
 * Configuration in the 2026-09 IA pass so order configuration sits with order
 * uploads. Both read the account's store fields; the mapping section
 * additionally needs the configured source field, its existing value→platform
 * mappings, and the distinct raw values present in uploaded orders.
 */
async function OrderFieldsTab() {
  const fields = await listStoreFields();
  const sourceFieldKey = await getStoreSourceFieldKey();
  const [mappings, values] = await Promise.all([
    listStoreSourceMappings(),
    distinctStoreSourceValues(sourceFieldKey),
  ]);
  return (
    <div className="space-y-10">
      <StoreFieldsAdmin fields={fields} sourceFieldKey={sourceFieldKey} />
      <StoreSourceMappingAdmin
        fields={fields}
        sourceFieldKey={sourceFieldKey}
        mappings={mappings}
        values={values}
      />
    </div>
  );
}
