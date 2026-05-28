import Link from "next/link";
import { Plus, Upload as UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { creatives, products, uploadBatches, users } from "@/db/schema";
import { isoDate, int } from "@/lib/format";
import { auth } from "@/lib/auth";
import { RollbackButton } from "@/components/upload/rollback-button";
import { CleanupTool } from "@/components/cleanup/cleanup-tool";

const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// Always fetch fresh — this page reflects newly-committed batches.
export const dynamic = "force-dynamic";

const PLATFORM_LABEL: Record<string, string> = {
  meta: "Meta",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  google: "Google",
};

export default async function UploadsPage() {
  const currentUser = await auth();
  const isAdmin = currentUser?.role === "admin";
  // Rollback stays admin-only; record cleanup is open to editors too.
  const canCleanup =
    currentUser?.role === "admin" || currentUser?.role === "editor";

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
    .orderBy(desc(uploadBatches.uploadedAt))
    .limit(50);

  // Filter options for the cleanup tool (fetched for editors + admins).
  const [cleanupProducts, cleanupCreatives] = canCleanup
    ? await Promise.all([
        db
          .select({ id: products.id, name: products.name })
          .from(products)
          .orderBy(asc(products.name)),
        db
          .select({
            id: creatives.id,
            name: creatives.name,
            productName: products.name,
          })
          .from(creatives)
          .innerJoin(products, eq(products.id, creatives.productId))
          .orderBy(asc(creatives.name)),
      ])
    : [[], []];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
            Uploads
          </div>
          <h1 className="font-display text-4xl tracking-tight">Upload history</h1>
          <p className="text-ink-2 text-sm mt-1">
            Every CSV the team has imported. {rows.length} {rows.length === 1 ? "batch" : "batches"}.
          </p>
        </div>
        <Button asChild>
          <Link href="/uploads/new">
            <Plus className="w-4 h-4" />
            New upload
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-surface-2 border border-line flex items-center justify-center">
            <UploadIcon className="w-5 h-5 text-ink-2" />
          </div>
          <p className="mt-4 text-ink-2 text-sm">No uploads yet.</p>
          <p className="mt-1 text-ink-3 text-xs">
            Start with a Meta export or any of the four supported platforms.
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
              <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
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
                const rollable = isAdmin && r.status === "active" && inWindow;
                return (
                  <tr key={r.id} className="hover:bg-surface-2/60 transition-colors">
                    <td className="px-3 py-2.5 text-ink-2">{isoDate(r.uploadedAt)}</td>
                    <td className="px-3 py-2.5 text-ink-2">{PLATFORM_LABEL[r.platform] ?? r.platform}</td>
                    <td className="px-3 py-2.5 font-mono text-ink text-[13px]">{r.fileName}</td>
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

      <p className="text-[11px] text-ink-3">
        Admins can roll back any batch within 24 h of upload. Beyond that
        window, use the cleanup tool below or contact an operator.
      </p>

      {canCleanup && (
        <CleanupTool products={cleanupProducts} creatives={cleanupCreatives} />
      )}
    </div>
  );
}
