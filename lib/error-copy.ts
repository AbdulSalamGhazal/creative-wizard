/**
 * Which error screens say "we couldn't reach the data" (calm, retryable)
 * rather than "something went wrong" — ONE heuristic for the dashboard's
 * error boundary and the global one (R-039, 2026-11-07). Plain module: both
 * are client components.
 */

/** A reachability/connection failure (the database briefly down). */
export function looksLikeDbError(message: string | undefined): boolean {
  return /connect|timeout|econnrefused|database|terminat|pool/i.test(message ?? "");
}

/**
 * Production REDACTS a server error's message (only the digest survives), so
 * the heuristic above can't see it. The global boundary takes a redacted
 * server error as a data blip: the dashboard layout's only failure mode is a
 * read (the session, the brand list, the preferences).
 */
export function isRedactedServerError(error: { message?: string; digest?: string }): boolean {
  return (
    Boolean(error.digest) &&
    /server components render|omitted in production builds/i.test(error.message ?? "")
  );
}
