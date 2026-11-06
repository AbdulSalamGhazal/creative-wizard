/**
 * The member lifecycle (D4, 2026-11-06) — PURE, so the Team page, the
 * actions and the tests read one definition.
 *
 * Three states from two stamps on `users`:
 *  · `active`      — neither stamp set.
 *  · `deactivated` — `deactivated_at` set: can't sign in, every session and
 *                    token refuses them, still on the Team page. REVERSIBLE.
 *  · `removed`     — `removed_at` set: off the Team page for good, their
 *                    credentials and memberships purged, the email free to
 *                    invite again. The row stays so history keeps its names.
 * Removed wins over deactivated when both are set (a deactivated person can
 * be removed; the reverse never happens).
 */
export type MemberStatus = "active" | "deactivated" | "removed";

export interface LifecycleStamps {
  deactivatedAt: Date | string | null;
  removedAt: Date | string | null;
}

export function memberStatus(row: LifecycleStamps): MemberStatus {
  if (row.removedAt) return "removed";
  if (row.deactivatedAt) return "deactivated";
  return "active";
}

/** May this person sign in and hold a session or a token right now? */
export function canHoldSession(row: LifecycleStamps): boolean {
  return memberStatus(row) === "active";
}

/** The Team page's one-word status badge; null for an active member (no badge). */
export const MEMBER_STATUS_LABEL: Record<MemberStatus, string | null> = {
  active: null,
  deactivated: "Deactivated",
  removed: "Removed",
};

/** What the sign-in form says to a deactivated person who typed the right password. */
export const DEACTIVATED_SIGNIN_MESSAGE =
  "This account has been deactivated. Ask an admin to reactivate it.";
