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
): void {
  if (result.stale) {
    toast.error(result.error ?? fallback, {
      id: "stale-deployment",
      duration: Infinity,
      // Persistent, so it must be dismissable without reloading.
      closeButton: true,
      action: { label: "Reload", onClick: () => window.location.reload() },
    });
    return;
  }
  toast.error(result.error ?? fallback);
}
