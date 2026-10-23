/**
 * The cleanup tools' last line (W1-7, 2026-10-23): a hard delete removes
 * EXACTLY what the user previewed, or nothing.
 *
 * Both tools (ads `upload.cleanup`, store `store.cleanup`) preview a count,
 * ask for a typed DELETE, then delete by the same filters. The client used to
 * send its LIVE filters — and a filter edited while a preview was in flight
 * let the stale preview land beside new filters — so the delete could cover a
 * scope nobody saw counted. Now the client sends the filters it previewed with
 * the count it was shown, and the server deletes inside a transaction that
 * rolls back unless it removed that many rows.
 */
export const CLEANUP_SCOPE_CHANGED =
  "The matching records changed since your preview. Preview again before deleting.";

/** Thrown inside the delete transaction to roll it back. */
export class CleanupScopeChangedError extends Error {
  constructor(
    readonly deleted: number,
    readonly expected: number,
  ) {
    super(CLEANUP_SCOPE_CHANGED);
    this.name = "CleanupScopeChangedError";
  }
}
