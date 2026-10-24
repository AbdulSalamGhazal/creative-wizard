/**
 * Upload-batch facts shared by BOTH upload histories (ads `/uploads`, Store
 * `/store/uploads`), their rollback actions and their rollback buttons — a
 * plain module so a server action, a server page and a client table read the
 * same values (W3-3/W3-7: the window was defined five times, and the ads
 * history printed the stored `rolled_back` identifier).
 */

/** How long after upload a batch can still be rolled back. */
export const ROLLBACK_WINDOW_HOURS = 24;
export const ROLLBACK_WINDOW_MS = ROLLBACK_WINDOW_HOURS * 60 * 60 * 1000;

/** True while a batch uploaded at `uploadedAt` is inside the rollback window.
 *  The server action and the UI's "eligible" check both call this. */
export function withinRollbackWindow(
  uploadedAt: Date | string,
  now: number = Date.now(),
): boolean {
  const at = typeof uploadedAt === "string" ? Date.parse(uploadedAt) : uploadedAt.getTime();
  return now - at <= ROLLBACK_WINDOW_MS;
}

/** A batch status in the product's words — never the stored identifier
 *  (the ads history printed `rolled_back`; the Store history's wording won). */
export function batchStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}
