import { db } from "@/lib/db";
import { auditEvents } from "@/db/schema";

/**
 * Append-only audit trail.
 *
 * Every mutation in the system calls `logAudit(...)`. Failures are logged
 * but never thrown — a write to `audit_events` going wrong must not block
 * the user's primary action, and the actor already saw the result of the
 * action they took.
 *
 * Action constants live here so the set is finite, greppable, and easy to
 * extend. The audit feed in /admin/audit pretty-prints these via
 * AUDIT_LABELS below.
 */

export const AUDIT_ACTIONS = {
  // Creatives
  CREATIVE_CREATE: "creative.create",
  CREATIVE_UPDATE: "creative.update",
  CREATIVE_NOTES_UPDATE: "creative.notes_update",
  CREATIVE_STATUS_BULK: "creative.bulk_status",

  // Exclusions
  EXCLUSION_EXCLUDE: "exclusion.exclude",
  EXCLUSION_INCLUDE: "exclusion.include",

  // Uploads
  UPLOAD_COMMIT: "upload.commit",
  UPLOAD_ROLLBACK: "upload.rollback",

  // Products
  PRODUCT_CREATE: "product.create",
  PRODUCT_ARCHIVE: "product.archive",
  PRODUCT_RESTORE: "product.restore",

  // Users
  USER_INVITE: "user.invite",
  USER_ROLE_CHANGE: "user.role_change",
  USER_PASSWORD_RESET: "user.password_reset",

  // Platform header mappings
  MAPPING_ADD: "mapping.add",
  MAPPING_REMOVE: "mapping.remove",

  // Auth
  AUTH_SIGNIN: "auth.signin",
  AUTH_SIGNIN_FAILED: "auth.signin_failed",
  AUTH_SIGNOUT: "auth.signout",
  AUTH_PASSWORD_CHANGE: "auth.password_change",

  // Saved views
  VIEW_CREATE: "view.create",
  VIEW_DELETE: "view.delete",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditEntityType =
  | "creative"
  | "product"
  | "user"
  | "upload"
  | "exclusion"
  | "mapping"
  | "auth"
  | "view";

export interface AuditEventInput {
  action: AuditAction;
  entityType: AuditEntityType;
  /** Entity primary key as a string. Null when not applicable (e.g. bulk ops, auth attempts). */
  entityId?: string | null;
  /** Human-readable label captured at write time — survives entity deletion. */
  entityLabel?: string | null;
  /** Acting user id. Null for anonymous events (failed sign-in attempts). */
  actorUserId?: string | null;
  /** Action-specific extras. Keep small; large blobs belong elsewhere. */
  meta?: Record<string, unknown> | null;
}

/**
 * Fire-and-forget audit write. Never throws.
 *
 * Returns the new row id when the insert succeeded, or null if it failed.
 * Callers don't usually care — the return is there for tests.
 */
export async function logAudit(input: AuditEventInput): Promise<number | null> {
  try {
    const [row] = await db
      .insert(auditEvents)
      .values({
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityLabel: input.entityLabel ?? null,
        actorUserId: input.actorUserId ?? null,
        meta: input.meta ?? null,
      })
      .returning({ id: auditEvents.id });
    return row?.id ?? null;
  } catch (err) {
    console.warn("logAudit failed (suppressed):", err);
    return null;
  }
}

/** Pretty labels for the feed UI. Keep in sync with AUDIT_ACTIONS. */
export const AUDIT_LABELS: Record<AuditAction, string> = {
  "creative.create": "Created creative",
  "creative.update": "Updated creative",
  "creative.notes_update": "Edited notes",
  "creative.bulk_status": "Bulk status change",
  "exclusion.exclude": "Excluded record",
  "exclusion.include": "Re-included record",
  "upload.commit": "Committed upload",
  "upload.rollback": "Rolled back upload",
  "product.create": "Created product",
  "product.archive": "Archived product",
  "product.restore": "Restored product",
  "user.invite": "Invited user",
  "user.role_change": "Changed user role",
  "user.password_reset": "Reset user password",
  "mapping.add": "Added CSV mapping",
  "mapping.remove": "Removed CSV mapping",
  "auth.signin": "Signed in",
  "auth.signin_failed": "Failed sign-in",
  "auth.signout": "Signed out",
  "auth.password_change": "Changed password",
  "view.create": "Saved a view",
  "view.delete": "Deleted a view",
};

/** Coarse grouping for filter chips. */
export const AUDIT_CATEGORIES: Record<AuditAction, AuditEntityType> = {
  "creative.create": "creative",
  "creative.update": "creative",
  "creative.notes_update": "creative",
  "creative.bulk_status": "creative",
  "exclusion.exclude": "exclusion",
  "exclusion.include": "exclusion",
  "upload.commit": "upload",
  "upload.rollback": "upload",
  "product.create": "product",
  "product.archive": "product",
  "product.restore": "product",
  "user.invite": "user",
  "user.role_change": "user",
  "user.password_reset": "user",
  "mapping.add": "mapping",
  "mapping.remove": "mapping",
  "auth.signin": "auth",
  "auth.signin_failed": "auth",
  "auth.signout": "auth",
  "auth.password_change": "auth",
  "view.create": "view",
  "view.delete": "view",
};
