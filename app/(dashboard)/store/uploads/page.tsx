import Link from "next/link";
import { Plus, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { auth, can } from "@/lib/auth";
import { listStoreBatches } from "@/db/queries/store";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { RecentStoreBatches } from "@/components/store/recent-store-batches";

export const dynamic = "force-dynamic";

export const metadata = { title: "Store uploads" };

/**
 * Order uploads — the store upload HISTORY (batches: file, when, by, counts,
 * upsert, rollback while eligible). Mirrors the ads /uploads page. The upload
 * flow itself lives on /store/uploads/new. Gated by `store.upload` /
 * `upload.rollback` (the nav item is too).
 */
export default async function StoreUploadsPage() {
  const user = await auth();
  const canUpload = user ? can(user, "store.upload") : false;
  const canRollback = user ? can(user, "upload.rollback") : false;

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
    </PageShell>
  );
}
