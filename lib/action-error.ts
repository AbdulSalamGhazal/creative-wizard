/**
 * One place that turns a caught exception into a message a user should see.
 *
 * Forwarding `err.message` straight out of a Server Action leaks internals to
 * the client — Postgres constraint text, column names, connection strings in a
 * driver error. Almost none of it helps the person reading it, and some of it
 * describes the schema to someone who shouldn't have it.
 *
 * Deliberately CONSTRUCTED messages are the exception and pass through: a
 * permission denial tells the user something true and actionable that the
 * generic text would hide. Everything else is generalized, and the real error
 * goes to `console.error` — visible in Vercel's logs, where it belongs.
 */
export const GENERIC_ACTION_ERROR = "Something went wrong — try again.";

/** Messages an action raised ON PURPOSE, safe (and useful) to show as-is. */
function isDeliberate(message: string): boolean {
  return (
    message.startsWith("Missing permission:") ||
    message.startsWith("You don't have permission")
  );
}

/**
 * `context` is a short tag for the log line (e.g. "createProduct") so a report
 * of "something went wrong" can be traced to the action that produced it.
 */
export function actionError(err: unknown, context: string): string {
  if (err instanceof Error && isDeliberate(err.message)) return err.message;
  console.error(`[action:${context}]`, err);
  return GENERIC_ACTION_ERROR;
}
