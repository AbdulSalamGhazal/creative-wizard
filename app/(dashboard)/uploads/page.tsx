import Link from "next/link";
import { Plus, Upload as UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { creatives, products, uploadBatches, users } from "@/db/schema";
import { isoDate, int } from "@/lib/format";
import { PLATFORM_LABEL } from "@/lib/palette";
import { auth, can } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { RollbackButton } from "@/components/upload/rollback-button";
import { CleanupTool } from "@/components/cleanup/cleanup-tool";
import { listAccountCampaigns } from "@/db/queries/cleanup";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// Always fetch fresh — this page reflects newly-committed batches.
export const dynamic = "force-dynamic";

export default async function UploadsPage() {
  const currentUser = await auth();
  const canImport = currentUser ? can(currentUser, "upload.import") : false;
  const canRollback = currentUser ? can(currentUser, "upload.rollback") : false;
  const canCleanup = currentUser ? can(currentUser, "upload.cleanup") : false;

  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: uploadBatches.id,
      platform: uploadBatches.platform,
      fileName: uploadBatches.fileName,
      uploadedAt: uploadBatches.uploadedAt,
      rowsImported: uploadBatches.rowsImported,
      status: uploadBatches.status,
      uploaderName: users.name,
    })
    .from(uploadBatches)
    .innerJoin(users, eq(users.id, uploadBatches.uploadedByUserId))
    .where(eq(uploadBatches.accountId, acct))
    .orderBy(desc(uploadBatches.uploadedAt))
    .limit(50);

  // Filter options for the cleanup tool (fetched for editors + admins).
  const [cleanupProducts, cleanupCreatives, cleanupCampaigns] = canCleanup
    ? await Promise.all([
        db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.accountId, acct))
          .orderBy(asc(products.name)),
        db
          .select({
            id: creatives.id,
            name: creatives.name,
            productName: products.name,
          })
          .from(creatives)
          .innerJoin(products, eq(products.id, creatives.productId))
          .where(eq(creatives.accountId, acct))
          .orderBy(asc(creatives.name)),
        listAccountCampaigns(),
      ])
    : [[], [], []];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Uploads"
        title="Upload history"
        subtitle={`${rows.length} ${rows.length === 1 ? "batch" : "batches"}.`}
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

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-surface-2 border border-line flex items-center justify-center">
            <UploadIcon className="w-5 h-5 text-ink-2" />
          </div>
          <p className="mt-4 text-ink-2 text-sm">No uploads yet.</p>
          <p className="mt-1 text-ink-3 text-xs">
            Start with an Instagram or Facebook export, or any of the four supported platforms.
          </p>
          <div className="mt-4">
            <Button asChild>
              <Link href="/uploads/new">Run your first upload</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm num">
            <thead>
              <tr className="text-left text-label text-ink-3 border-b border-line">
                <th className="font-medium px-3 py-2.5">Uploaded</th>
                <th className="font-medium px-3 py-2.5">Platform</th>
                <th className="font-medium px-3 py-2.5">File</th>
                <th className="font-medium px-3 py-2.5">By</th>
                <th className="font-medium px-3 py-2.5 text-right">Rows</th>
                <th className="font-medium px-3 py-2.5">Status</th>
                <th className="font-medium px-3 py-2.5 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const inWindow =
                  Date.now() - r.uploadedAt.getTime() < ROLLBACK_WINDOW_MS;
                const rollable = canRollback && r.status === "active" && inWindow;
                return (
                  <tr key={r.id} className="hover:bg-surface-2/60 transition-colors">
                    <td className="px-3 py-2.5 text-ink-2">{isoDate(r.uploadedAt)}</td>
                    <td className="px-3 py-2.5 text-ink-2">{PLATFORM_LABEL[r.platform as keyof typeof PLATFORM_LABEL] ?? r.platform}</td>
                    <td className="px-3 py-2.5 font-mono text-ink text-xs">{r.fileName}</td>
                    <td className="px-3 py-2.5 text-ink-2">{r.uploaderName}</td>
                    <td className="px-3 py-2.5 text-right text-ink">{int(r.rowsImported)}</td>
                    <td className="px-3 py-2.5">
                      {r.status === "active" ? (
                        <span className="inline-flex items-center h-5 px-1.5 rounded text-[10px] border border-pos/40 text-pos bg-pos/10">
                          active
                        </span>
                      ) : (
                        <span className="inline-flex items-center h-5 px-1.5 rounded text-[10px] border border-line-2 text-ink-3 bg-surface-2">
                          {r.status}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {rollable && (
                        <RollbackButton
                          batchId={r.id}
                          fileName={r.fileName}
                          rowCount={r.rowsImported}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(canRollback || canCleanup) && (
        <p className="text-[11px] text-ink-3">
          Roll back any batch within 24 h of upload. Beyond that window, use the
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
