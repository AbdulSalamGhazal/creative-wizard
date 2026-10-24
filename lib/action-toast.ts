import { toast } from "sonner";

/**
 * Toast a failed action result — the client half of lib/action-failure.ts.
 *
 * ONE place decides how a failure reads, so a stale tab gets the same
 * "Reload" offer whichever button it clicked: a deploy-skew failure can only
 * be fixed by reloading, so the toast says so and offers it, and it stays up
 * until dismissed — with a close button, since it never times out (an
 * 8-second sentence about a broken tab helps nobody who looked away). It
 * carries a fixed id, so five failed clicks are one toast.
 */
export function toastActionFailure(
  result: { ok?: boolean; error?: string; stale?: boolean },
  fallback: string,
  options: {
    /**
     * A FORM shows its failure inline, where the person is looking (the
     * ux-standards rule: a toast for a row, a banner for a form). The message
     * goes there instead of a toast — except that a stale tab ALSO gets the
     * Reload toast, because nothing on the form can fix it.
     */
    inline?: (message: string) => void;
  } = {},
): void {
  const message = result.error ?? fallback;
  if (result.stale) {
    options.inline?.(message);
    toast.error(message, {
      id: "stale-deployment",
      duration: Infinity,
      // Persistent, so it must be dismissable without reloading.
      closeButton: true,
      action: { label: "Reload", onClick: () => window.location.reload() },
    });
    return;
  }
  if (options.inline) {
    options.inline(message);
    return;
  }
  toast.error(message);
}

/**
 * Did the CALL fail (network, stale deploy — `safeAction`'s `ActionFailure`),
 * as opposed to the action answering `{ ok: false }`? A best-effort preference
 * write stays quiet about its own refusal, but a broken tab must still say so.
 */
export function isCallFailure(result: { ok: boolean; error?: unknown }): boolean {
  return !result.ok && typeof result.error === "string";
}
