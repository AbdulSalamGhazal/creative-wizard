import { db } from "@/lib/db";
import { auditEvents } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";

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
  CREATIVE_BULK_CREATE: "creative.bulk_create",
  CREATIVE_UPDATE: "creative.update",
  CREATIVE_NOTES_UPDATE: "creative.notes_update",
  CREATIVE_SOURCE_UPDATE: "creative.source_update",
  CREATIVE_STATUS_BULK: "creative.bulk_status",
  CREATIVE_DELETE: "creative.delete",

  // Campaigns
  CAMPAIGN_CREATE: "campaign.create",
  CAMPAIGN_UPDATE: "campaign.update",
  CAMPAIGN_DELETE: "campaign.delete",

  // Exclusions
  EXCLUSION_EXCLUDE: "exclusion.exclude",
  EXCLUSION_INCLUDE: "exclusion.include",
  EXCLUSION_RULE_CREATE: "exclusion.rule_create",
  EXCLUSION_RULE_TOGGLE: "exclusion.rule_toggle",
  EXCLUSION_RULE_DELETE: "exclusion.rule_delete",

  // Uploads
  UPLOAD_COMMIT: "upload.commit",
  UPLOAD_ROLLBACK: "upload.rollback",
  RECORDS_BULK_DELETE: "upload.bulk_delete",

  // Products
  PRODUCT_CREATE: "product.create",
  PRODUCT_ARCHIVE: "product.archive",
  PRODUCT_RESTORE: "product.restore",

  // Users
  USER_INVITE: "user.invite",
  USER_ROLE_CHANGE: "user.role_change",
  USER_PERMISSIONS_UPDATE: "user.permissions_update",
  USER_BRANDS_UPDATE: "user.brands_update",
  USER_PASSWORD_RESET: "user.password_reset",

  // Personal API access tokens (MCP)
  TOKEN_CREATE: "token.create",
  TOKEN_REVOKE: "token.revoke",

  // Store module (Salla orders)
  STORE_FIELDS_UPDATE: "store.fields_update",
  STORE_UPLOAD_COMMIT: "store.upload_commit",
  STORE_UPLOAD_ROLLBACK: "store.upload_rollback",
  STORE_BULK_DELETE: "store.bulk_delete",
  STORE_SOURCE_MAPPING_UPDATE: "store.source_mapping_update",

  // Platform header mappings
  MAPPING_ADD: "mapping.add",
  MAPPING_REMOVE: "mapping.remove",

  // Auth
  AUTH_SIGNIN: "auth.signin",
  AUTH_SIGNIN_FAILED: "auth.signin_failed",
  AUTH_SIGNIN_THROTTLED: "auth.signin_throttled",
  AUTH_SIGNOUT: "auth.signout",
  AUTH_PASSWORD_CHANGE: "auth.password_change",

  // Saved views
  VIEW_CREATE: "view.create",
  VIEW_DELETE: "view.delete",
  VIEW_SET_DEFAULT: "view.set_default",

  // Angles (vocabulary)
  ANGLE_CREATE: "angle.create",
  ANGLE_RENAME: "angle.rename",
  ANGLE_DELETE: "angle.delete",

  // Rating rules (Summary rate config)
  RATING_UPDATE: "rating.update",

  // Budget module
  BUDGET_UPDATE: "budget.update",

  // Brands (accounts)
  ACCOUNT_CREATE: "account.create",
  ACCOUNT_RENAME: "account.rename",
  ACCOUNT_WINDOW_UPDATE: "account.window_update",
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
  | "view"
  | "angle"
  // Legacy: rows written before the 2026-09 tag → angle rename carry this.
  | "tag"
  | "rating"
  | "account"
  | "campaign"
  | "store"
  | "budget";

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
  /**
   * Account (brand) this event belongs to. Defaults to the request's active
   * account. The upload pipeline passes the session's account explicitly so a
   * mid-flow brand switch can't mis-file the commit/rollback audit.
   */
  accountId?: string;
}

/**
 * Fire-and-forget audit write. Never throws.
 *
 * Returns the new row id when the insert succeeded, or null if it failed.
 * Callers don't usually care — the return is there for tests.
 */
export async function logAudit(input: AuditEventInput): Promise<number | null> {
  try {
    const accountId = input.accountId ?? (await getActiveAccountId());
    const [row] = await db
      .insert(auditEvents)
      .values({
        accountId,
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
/**
 * Actions retired by a RENAME. `audit_events` is append-only — historical rows
 * keep the exact string they were written with, and are shown with their
 * ORIGINAL wording so the log stays a faithful record of what happened at the
 * time. 2026-09: the "tag" concept became "angle" (`tag.*` → `angle.*`); these
 * entries are read-only history and nothing new is ever written with them.
 */
export const LEGACY_AUDIT_LABELS: Record<string, string> = {
  "tag.create": "Created tag",
  "tag.rename": "Renamed tag",
  "tag.delete": "Deleted tag",
};

export const LEGACY_AUDIT_CATEGORIES: Record<string, AuditEntityType> = {
  "tag.create": "tag",
  "tag.rename": "tag",
  "tag.delete": "tag",
};

export const AUDIT_LABELS: Record<AuditAction, string> = {
  "creative.create": "Created creative",
  "creative.bulk_create": "Bulk-created creatives",
  "creative.update": "Updated creative",
  "creative.notes_update": "Edited notes",
  "creative.source_update": "Edited source link",
  "creative.bulk_status": "Bulk status change",
  "creative.delete": "Deleted creative",
  "campaign.create": "Registered campaign",
  "campaign.update": "Edited campaign",
  "campaign.delete": "Deleted campaign",
  "exclusion.exclude": "Excluded record",
  "exclusion.include": "Re-included record",
  "exclusion.rule_create": "Created exclusion rule",
  "exclusion.rule_toggle": "Toggled exclusion rule",
  "exclusion.rule_delete": "Deleted exclusion rule",
  "upload.commit": "Committed upload",
  "upload.rollback": "Rolled back upload",
  "upload.bulk_delete": "Bulk-deleted records",
  "product.create": "Created product",
  "product.archive": "Archived product",
  "product.restore": "Restored product",
  "user.invite": "Invited user",
  "user.role_change": "Changed user role",
  "user.permissions_update": "Updated user access",
  "user.brands_update": "Updated brand access",
  "user.password_reset": "Reset user password",
  "token.create": "Created API token",
  "token.revoke": "Revoked API token",
  "store.fields_update": "Updated store fields",
  "store.upload_commit": "Committed store upload",
  "store.upload_rollback": "Rolled back store upload",
  "store.bulk_delete": "Bulk-deleted store orders",
  "store.source_mapping_update": "Updated store source mapping",
  "mapping.add": "Added CSV mapping",
  "mapping.remove": "Removed CSV mapping",
  "auth.signin": "Signed in",
  "auth.signin_failed": "Failed sign-in",
  "auth.signin_throttled": "Sign-in throttled",
  "auth.signout": "Signed out",
  "auth.password_change": "Changed password",
  "view.create": "Saved a view",
  "view.delete": "Deleted a view",
  "view.set_default": "Changed default view",
  "angle.create": "Created angle",
  "angle.rename": "Renamed angle",
  "angle.delete": "Deleted angle",
  "rating.update": "Updated rating rules",
  "budget.update": "Updated budget plan",
  "account.create": "Created brand",
  "account.rename": "Renamed brand",
  "account.window_update": "Changed status window",
};

/** Coarse grouping for filter chips. */
export const AUDIT_CATEGORIES: Record<AuditAction, AuditEntityType> = {
  "creative.create": "creative",
  "creative.bulk_create": "creative",
  "creative.update": "creative",
  "creative.notes_update": "creative",
  "creative.source_update": "creative",
  "creative.bulk_status": "creative",
  "creative.delete": "creative",
  "campaign.create": "campaign",
  "campaign.update": "campaign",
  "campaign.delete": "campaign",
  "exclusion.exclude": "exclusion",
  "exclusion.include": "exclusion",
  "exclusion.rule_create": "exclusion",
  "exclusion.rule_toggle": "exclusion",
  "exclusion.rule_delete": "exclusion",
  "upload.commit": "upload",
  "upload.rollback": "upload",
  "upload.bulk_delete": "upload",
  "product.create": "product",
  "product.archive": "product",
  "product.restore": "product",
  "user.invite": "user",
  "user.role_change": "user",
  "user.permissions_update": "user",
  "user.brands_update": "user",
  "user.password_reset": "user",
  "token.create": "user",
  "token.revoke": "user",
  "store.fields_update": "store",
  "store.upload_commit": "store",
  "store.upload_rollback": "store",
  "store.bulk_delete": "store",
  "store.source_mapping_update": "store",
  "mapping.add": "mapping",
  "mapping.remove": "mapping",
  "auth.signin": "auth",
  "auth.signin_failed": "auth",
  "auth.signin_throttled": "auth",
  "auth.signout": "auth",
  "auth.password_change": "auth",
  "view.create": "view",
  "view.delete": "view",
  "view.set_default": "view",
  "angle.create": "angle",
  "angle.rename": "angle",
  "angle.delete": "angle",
  "rating.update": "rating",
  "budget.update": "budget",
  "account.create": "account",
  "account.rename": "account",
  "account.window_update": "account",
};

/** Human label for an audit action, including retired (renamed) ones. */
export function auditLabel(action: string): string {
  return (
    AUDIT_LABELS[action as AuditAction] ?? LEGACY_AUDIT_LABELS[action] ?? action
  );
}

/** Category for an audit action, including retired (renamed) ones. */
export function auditCategory(action: string): AuditEntityType | null {
  return (
    AUDIT_CATEGORIES[action as AuditAction] ??
    LEGACY_AUDIT_CATEGORIES[action] ??
    null
  );
}
