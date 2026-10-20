/**
 * A server action call that REJECTED, turned into a result the UI can show
 * (2026-10). Pure — no React, no toasts — so the rules are testable.
 *
 * Every action in this app catches its own errors and RETURNS `{ ok: false,
 * error }`. What it cannot catch is the call itself failing on the way: the
 * network blinks, or — the common case here, because `main` deploys many times
 * a day — a tab opened before the last deploy calls an action id the new
 * server no longer knows. Next then THROWS on the client, and an uncaught
 * rejection inside `startTransition` lands on the route's error boundary: the
 * reader loses the page over a 👍. `safeAction` makes that impossible: the
 * call resolves to a failure result like any other, and the caller toasts it
 * with `toastActionFailure` (lib/action-toast.ts).
 */

export interface ActionFailure {
  ok: false;
  error: string;
  /** The tab predates the running deployment — only a reload fixes it. */
  stale?: boolean;
}

export const STALE_DEPLOYMENT_MESSAGE = "Wizard was updated — reload.";

export const OFFLINE_MESSAGE = "Can't reach the server.";

/** Mirrors lib/action-error's GENERIC_ACTION_ERROR — one voice for "it broke". */
export const UNKNOWN_FAILURE_MESSAGE = "Something went wrong — try again.";

function nameAndMessage(err: unknown): { name: string; message: string } {
  if (typeof err === "object" && err !== null) {
    const { name, message } = err as { name?: unknown; message?: unknown };
    return {
      name: typeof name === "string" ? name : "",
      message: typeof message === "string" ? message : "",
    };
  }
  return { name: "", message: typeof err === "string" ? err : "" };
}

/**
 * Is this the "server action not found" a stale tab gets after a deploy? Next
 * throws an `UnrecognizedActionError` (client) or relays "Failed to find
 * Server Action … older or newer deployment" (server). Matched by name and
 * wording rather than through Next's `unstable_` helper, so a Next upgrade
 * that renames the helper can't silently turn this back into a crash.
 */
export function isStaleDeploymentError(err: unknown): boolean {
  const { name, message } = nameAndMessage(err);
  return (
    name === "UnrecognizedActionError" ||
    /Server Action\b.*\bwas not found on the server/i.test(message) ||
    /Failed to find Server Action/i.test(message) ||
    /older or newer deployment/i.test(message)
  );
}

/** A fetch that never reached the server — every browser words it differently. */
export function isNetworkError(err: unknown): boolean {
  const { name, message } = nameAndMessage(err);
  return (
    (name === "TypeError" &&
      /failed to fetch|networkerror|load failed|network request failed/i.test(message)) ||
    /fetch failed|network ?error|ERR_INTERNET_DISCONNECTED/i.test(message)
  );
}

export function describeActionFailure(err: unknown): ActionFailure {
  if (isStaleDeploymentError(err)) {
    return { ok: false, error: STALE_DEPLOYMENT_MESSAGE, stale: true };
  }
  if (isNetworkError(err)) return { ok: false, error: OFFLINE_MESSAGE };
  return { ok: false, error: UNKNOWN_FAILURE_MESSAGE };
}

/**
 * Run a server action call that must never reject. Resolves to the action's own
 * result, or to an `ActionFailure` describing why the call itself failed.
 */
export async function safeAction<T extends { ok: boolean }>(
  call: () => Promise<T>,
): Promise<T | ActionFailure> {
  try {
    return await call();
  } catch (err) {
    // Visible in the browser console for whoever is debugging; the user gets
    // a sentence instead of a crash.
    console.warn("Server action call failed:", err);
    return describeActionFailure(err);
  }
}
