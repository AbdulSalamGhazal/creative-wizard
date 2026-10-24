import Link from "next/link";
import { Plus, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { auth, can } from "@/lib/auth";
import { listStoreBatches, storeBatchRowsUpdatedSince } from "@/db/queries/store";
import { getActiveAccountId } from "@/lib/tenant";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { PageTabs, type PageTab } from "@/components/layout/page-tabs";
import { StoreFieldsAdmin } from "@/components/store/store-fields-admin";
import { StoreSourceMappingAdmin } from "@/components/store/store-source-mapping-admin";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { listStoreFields } from "@/db/queries/store";
import {
  listStoreSourceMappings,
  listStoreChannelMappings,
  distinctStoreSourceValues,
  distinctStoreChannelValues,
} from "@/db/queries/reconciliation";
import { ROLLBACK_WINDOW_HOURS, withinRollbackWindow } from "@/lib/upload-batches";
import { BatchHistoryTable } from "@/components/upload/batch-history-table";
import { StoreRollbackButton } from "@/components/store/store-rollback-button";
import { EmptyState } from "@/components/ui/empty-state";
import { TABLE_KEYS } from "@/lib/table-columns";
import { plural } from "@/lib/format";
import { UPLOAD_ORDERS_TABS, passes } from "@/lib/page-gates";
import { StoreCleanupTool } from "@/components/store/store-cleanup-tool";

export const dynamic = "force-dynamic";

export const metadata = { title: "Upload orders" };

/**
 * Order uploads — the store upload HISTORY (batches: file, when, by, counts,
 * upsert, rollback while eligible). Mirrors the ads /uploads page. The upload
 * flow itself lives on /store/uploads/new. The history is readable by every
 * member; the tab and actions are gated by `UPLOAD_ORDERS_TABS` /
 * `UPLOAD_ORDERS_ACTIONS` (lib/page-gates), which the nav item derives from.
 */
const [TAB_HISTORY_DEF, TAB_FIELDS_DEF] = UPLOAD_ORDERS_TABS;
const TAB_HISTORY = TAB_HISTORY_DEF.key;
const TAB_FIELDS = TAB_FIELDS_DEF.key;

export default async function StoreUploadsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await auth();
  const canUpload = user ? can(user, "store.upload") : false;
  const canRollback = user ? can(user, "upload.rollback") : false;
  const canCleanup = user ? can(user, "store.cleanup") : false;
  const canFields = user ? passes(TAB_FIELDS_DEF.perm, (p) => can(user, p)) : false;

  const tabs: PageTab[] = [
    { key: TAB_HISTORY, label: TAB_HISTORY_DEF.label, href: "/store/uploads" },
    ...(canFields
      ? [{ key: TAB_FIELDS, label: TAB_FIELDS_DEF.label, href: `/store/uploads?tab=${TAB_FIELDS}` }]
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

  // One past the page's 50, so the count can say "latest" when it's capped.
  const fetched = await listStoreBatches(51);
  const capped = fetched.length > 50;
  const batches = fetched.slice(0, 50);
  // How many of each rollback-eligible batch's inserted orders a LATER upsert
  // has revised — surfaced in the rollback confirm.
  const acct = await getActiveAccountId();
  const updatedSince = new Map<string, number>(
    await Promise.all(
      batches
        .filter(
          (b) =>
            canRollback &&
            b.status === "active" &&
            withinRollbackWindow(b.uploadedAt),
        )
        .map(
          async (b) =>
            [b.id, await storeBatchRowsUpdatedSince(acct, b.id)] as const,
        ),
    ),
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Store"
        title="Upload orders"
        // A count is a fact, not helper text — "latest" when capped (C-21).
        subtitle={capped ? `Latest ${batches.length} batches.` : `${plural(batches.length, "batch", "batches")}.`}
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

      <BatchHistoryTable
        tableKey={TABLE_KEYS.UPLOAD_HISTORY_STORE}
        showPlatform={false}
        rows={batches.map((b) => ({
          id: b.id,
          uploadedAt: b.uploadedAt.toISOString(),
          fileName: b.fileName,
          uploadedBy: b.uploadedByName,
          rows: b.rowsInserted,
          updated: b.rowsUpdated,
          status: b.status,
          rollback:
            canRollback &&
            b.status === "active" &&
            b.rowsInserted > 0 &&
            withinRollbackWindow(b.uploadedAt) ? (
              <StoreRollbackButton
                batchId={b.id}
                fileName={b.fileName}
                rowsInserted={b.rowsInserted}
                updatedSince={updatedSince.get(b.id) ?? 0}
              />
            ) : null,
        }))}
        empty={
          <EmptyState
            size="lg"
            icon={<FileUp className="h-5 w-5" />}
            title="No uploads yet."
            hint="Upload a Salla order export to get started."
            action={
              canUpload ? (
                <Button asChild>
                  <Link href="/store/uploads/new">Upload your first export</Link>
                </Button>
              ) : undefined
            }
          />
        }
      />

      {(canRollback || canCleanup) && batches.length > 0 && (
        <p className="text-[11px] text-ink-3">
          Roll back a batch within {ROLLBACK_WINDOW_HOURS} h of upload. Beyond that window, use the
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
  // The source field is PINNED to utm_source (the picker is retired), so
  // nothing here waits on a config read to know which key to scan.
  const [fields, mappings, channelMappings] = await Promise.all([
    listStoreFields(),
    listStoreSourceMappings(),
    listStoreChannelMappings(),
  ]);
  // The FULL distinct scans live here and only here: this tab is where the
  // mapping UI has to list every raw value the brand has ever uploaded.
  // Reconciliation derives its banners from its own date-bounded scans instead.
  const values = await distinctStoreSourceValues(STORE_SOURCE_FIELD_KEY);
  const channelValues = await distinctStoreChannelValues();
  return (
    <div className="space-y-10">
      <StoreFieldsAdmin fields={fields} />
      <StoreSourceMappingAdmin
        mappings={mappings}
        values={values}
        channelMappings={channelMappings}
        channelValues={channelValues}
      />
    </div>
  );
}
