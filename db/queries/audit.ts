import { and, desc, eq, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, users } from "@/db/schema";
import type { AuditAction, AuditEntityType } from "@/lib/audit";

export interface AuditFeedFilters {
  /** Filter by action (e.g. "creative.update") or category ("creative"). */
  category?: AuditEntityType;
  /** Restrict to events for a specific entity instance. */
  entityType?: AuditEntityType;
  entityId?: string;
  /** Restrict to a specific actor. */
  actorUserId?: string;
  /** Cursor: only events strictly before this id. */
  beforeId?: number;
  /** Max rows. Hard-capped to avoid runaway lists. */
  limit?: number;
}

export interface AuditFeedRow {
  id: number;
  at: Date;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  meta: Record<string, unknown> | null;
  actor: { id: string; name: string; email: string } | null;
}

export async function listAuditEvents(
  filters: AuditFeedFilters = {},
): Promise<AuditFeedRow[]> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const conds: SQL[] = [];
  if (filters.category) conds.push(eq(auditEvents.entityType, filters.category));
  if (filters.entityType && !filters.category) {
    conds.push(eq(auditEvents.entityType, filters.entityType));
  }
  if (filters.entityId) {
    conds.push(eq(auditEvents.entityId, filters.entityId));
  }
  if (filters.actorUserId) {
    conds.push(eq(auditEvents.actorUserId, filters.actorUserId));
  }
  if (filters.beforeId !== undefined) {
    conds.push(lt(auditEvents.id, filters.beforeId));
  }

  const rows = await db
    .select({
      id: auditEvents.id,
      at: auditEvents.at,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      entityLabel: auditEvents.entityLabel,
      meta: auditEvents.meta,
      actorId: users.id,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(auditEvents.id))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action as AuditAction,
    entityType: r.entityType,
    entityId: r.entityId,
    entityLabel: r.entityLabel,
    meta: (r.meta as Record<string, unknown> | null) ?? null,
    actor: r.actorId
      ? { id: r.actorId, name: r.actorName ?? "", email: r.actorEmail ?? "" }
      : null,
  }));
}

/** Quick counts grouped by category for header chips. */
export async function auditCategoryCounts(): Promise<
  Array<{ category: string; count: number }>
> {
  const rows = await db
    .select({
      category: auditEvents.entityType,
      count: sql<number>`count(*)::int`,
    })
    .from(auditEvents)
    .groupBy(auditEvents.entityType);
  return rows;
}
