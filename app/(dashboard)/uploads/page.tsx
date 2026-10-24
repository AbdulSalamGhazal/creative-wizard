import Link from "next/link";
import { Plus, Upload as UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";
import { auth, can } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { RollbackButton } from "@/components/upload/rollback-button";
import { CleanupTool } from "@/components/cleanup/cleanup-tool";
import { listAccountCampaigns } from "@/db/queries/cleanup";
import { listCreativeOptions } from "@/db/queries/creatives";
import { listAllProductOptions } from "@/db/queries/products";
import { listUploadBatches } from "@/db/queries/uploads";
import { ROLLBACK_WINDOW_HOURS, withinRollbackWindow } from "@/lib/upload-batches";
import { BatchHistoryTable } from "@/components/upload/batch-history-table";
import { EmptyState } from "@/components/ui/empty-state";
import { TABLE_KEYS } from "@/lib/table-columns";
import { UPLOAD_ADS_TABS, passes } from "@/lib/page-gates";
import { batchRowsUpdatedSince } from "@/db/queries/performance";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { PageTabs, type PageTab } from "@/components/layout/page-tabs";
import { MappingsAdmin } from "@/components/platform/mappings-admin";

// Always fetch fresh — this page reflects newly-committed batches.
export const dynamic = "force-dynamic";

export const metadata = { title: "Upload ads" };

/**
 * CSV mapping (with the platform-readiness cards merged into it) moved here
 * from Configuration in the 2026-09 IA pass: header mapping is upload
 * configuration, so it belongs with the uploads it governs. `config.mappings`
 * gates the tab exactly as it gated the old Configuration tab.
 */
const [TAB_HISTORY_DEF, TAB_MAPPING_DEF] = UPLOAD_ADS_TABS; // lib/page-gates
const TAB_HISTORY = TAB_HISTORY_DEF.key;
const TAB_MAPPING = TAB_MAPPING_DEF.key;

export default async function UploadsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const currentUser = await auth();
  const canImport = currentUser ? can(currentUser, "upload.import") : false;
  const canRollback = currentUser ? can(currentUser, "upload.rollback") : false;
  const canCleanup = currentUser ? can(currentUser, "upload.cleanup") : false;
  const canMap = currentUser
    ? passes(TAB_MAPPING_DEF.perm, (p) => can(currentUser, p))
    : false;

  const tabs: PageTab[] = [
    { key: TAB_HISTORY, label: TAB_HISTORY_DEF.label, href: "/uploads" },
    ...(canMap
      ? [{ key: TAB_MAPPING, label: TAB_MAPPING_DEF.label, href: `/uploads?tab=${TAB_MAPPING}` }]
      : []),
  ];
  const { tab } = await searchParams;
  const activeTab = canMap && tab === TAB_MAPPING ? TAB_MAPPING : TAB_HISTORY;

  if (activeTab === TAB_MAPPING) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Ads"
          title="CSV mapping"
          info="Header matching is case-insensitive and whitespace-trimmed."
        />
        <PageTabs tabs={tabs} active={activeTab} />
        <MappingsAdmin />
      </PageShell>
    );
  }

  const acct = await getActiveAccountId();
  const { rows, capped } = await listUploadBatches(50);

  // How many of each rollback-eligible batch's rows a LATER upload has revised.
  // Only batches still inside the window can be rolled back, so only those are
  // worth the count.
  const updatedSinceByBatch = new Map<string, number>(
    await Promise.all(
      rows
        .filter(
          (r) =>
            canRollback &&
            r.status === "active" &&
            withinRollbackWindow(r.uploadedAt),
        )
        .map(
          async (r) =>
            [r.id, await batchRowsUpdatedSince(acct, r.id)] as const,
        ),
    ),
  );

  // Filter options for the cleanup tool (fetched for editors + admins).
  const [cleanupProducts, cleanupCreatives, cleanupCampaigns] = canCleanup
    ? await Promise.all([
        listAllProductOptions(),
        listCreativeOptions(),
        listAccountCampaigns(),
      ])
    : [[], [], []];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Ads"
        title="Upload ads"
        // A count is a fact, not helper text — and it says "latest" when the
        // list is capped, rather than passing the cap off as the total (C-21).
        subtitle={capped ? `Latest ${rows.length} batches.` : `${plural(rows.length, "batch", "batches")}.`}
        rightSlot={
          canImport ? (
            <Button asChild>
              <Link href="/uploads/new">
                <Plus className="w-4 h-4" />
                New upload
              </Link>
            </Button>
          ) : undefined
        }
      />

      <PageTabs tabs={tabs} active={activeTab} />

      <BatchHistoryTable
        tableKey={TABLE_KEYS.UPLOAD_HISTORY_ADS}
        showPlatform
        rows={rows.map((r) => ({
          id: r.id,
          uploadedAt: r.uploadedAt.toISOString(),
          platform: r.platform,
          fileName: r.fileName,
          uploadedBy: r.uploaderName,
          rows: r.rowsImported,
          status: r.status,
          rollback:
            canRollback && r.status === "active" && withinRollbackWindow(r.uploadedAt) ? (
              <RollbackButton
                batchId={r.id}
                fileName={r.fileName}
                rowCount={r.rowsImported}
                updatedSince={updatedSinceByBatch.get(r.id) ?? 0}
              />
            ) : null,
        }))}
        empty={
          <EmptyState
            size="lg"
            icon={<UploadIcon className="h-5 w-5" />}
            title="No uploads yet."
            hint="Start with an Instagram or Facebook export, or any of the four supported platforms."
            action={
              canImport ? (
                <Button asChild>
                  <Link href="/uploads/new">Run your first upload</Link>
                </Button>
              ) : undefined
            }
          />
        }
      />

      {(canRollback || canCleanup) && (
        <p className="text-[11px] text-ink-3">
          Roll back any batch within {ROLLBACK_WINDOW_HOURS} h of upload. Beyond that window, use the
          cleanup tool below or contact an operator.
        </p>
      )}

      {canCleanup && (
        <CleanupTool
          products={cleanupProducts}
          creatives={cleanupCreatives}
          campaigns={cleanupCampaigns}
        />
      )}
    </PageShell>
  );
}
