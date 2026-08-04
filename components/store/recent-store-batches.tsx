import { isoDate } from "@/lib/format";
import { StoreRollbackButton } from "@/components/store/store-rollback-button";

const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface StoreBatchDisplay {
  id: string;
  fileName: string;
  uploadedByName: string | null;
  uploadedAt: string; // ISO
  rowsInserted: number;
  rowsUpdated: number;
  upsert: boolean;
  status: string;
}

/** The last N store upload batches with a rollback button while eligible. */
export function RecentStoreBatches({
  batches,
  canRollback,
}: {
  batches: StoreBatchDisplay[];
  canRollback: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-4 py-2.5 text-sm font-medium text-ink">
        Recent uploads
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="px-4 py-2 font-medium">Uploaded</th>
              <th className="px-4 py-2 font-medium">File</th>
              <th className="px-4 py-2 font-medium">By</th>
              <th className="px-4 py-2 text-right font-medium">Rows</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {batches.map((b) => {
              const eligible =
                canRollback &&
                b.status === "active" &&
                b.rowsInserted > 0 &&
                Date.now() - Date.parse(b.uploadedAt) < ROLLBACK_WINDOW_MS;
              return (
                <tr key={b.id} className="text-ink-2">
                  <td className="px-4 py-2 num whitespace-nowrap">
                    {isoDate(b.uploadedAt)}
                  </td>
                  <td className="px-4 py-2 font-mono text-ink">{b.fileName}</td>
                  <td className="px-4 py-2">{b.uploadedByName ?? "—"}</td>
                  <td className="px-4 py-2 text-right num whitespace-nowrap">
                    {b.rowsInserted} new
                    {b.rowsUpdated > 0 && (
                      <span className="text-ink-3"> · {b.rowsUpdated} upd</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {b.status === "active" ? (
                      <span className="rounded bg-pos/10 px-1.5 py-0.5 text-[10px] text-pos">
                        active
                      </span>
                    ) : (
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">
                        rolled back
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {eligible && (
                      <StoreRollbackButton
                        batchId={b.id}
                        fileName={b.fileName}
                        rowsInserted={b.rowsInserted}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
