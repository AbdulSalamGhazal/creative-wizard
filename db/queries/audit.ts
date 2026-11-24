import { and, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, campaigns, parentCampaigns, users } from "@/db/schema";
import { adSetPath, campaignPath } from "@/lib/campaign";
import type { AuditAction, AuditEntityType } from "@/lib/audit";
import { getActiveAccountId } from "@/lib/tenant";

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
  actor: { id: string; name: string; email: string; avatarUrl: string | null } | null;
  /**
   * Where the entry's campaign or ad set lives TODAY (2026-11) — resolved from
   * the row's id, not from the label stored when the entry was written, so a
   * rename doesn't leave a dead link and a deleted one has none. NULL for
   * every other kind of entry (the feed derives those from the label).
   */
  livePath: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The current page of every campaign / ad set a page of entries names, by
 * `<entityType>:<entityId>` — two PK lookups for the whole page, each scoped
 * to the brand. `entity_id` is free text, so only uuid-shaped ids are asked.
 */
async function livePaths(
  acct: string,
  rows: ReadonlyArray<{ entityType: string; entityId: string | null }>,
): Promise<Map<string, string>> {
  const idsOf = (type: string) => [
    ...new Set(
      rows
        .filter((r) => r.entityType === type && r.entityId !== null && UUID.test(r.entityId))
        .map((r) => r.entityId as string),
    ),
  ];
  const adSetIds = idsOf("campaign");
  const parentIds = idsOf("parent_campaign");
  const [adSets, parents] = await Promise.all([
    adSetIds.length > 0
      ? db
          .select({ id: campaigns.id, name: campaigns.name })
          .from(campaigns)
          .where(and(eq(campaigns.accountId, acct), inArray(campaigns.id, adSetIds)))
      : [],
    parentIds.length > 0
      ? db
          .select({
            id: parentCampaigns.id,
            name: parentCampaigns.name,
            network: parentCampaigns.network,
          })
          .from(parentCampaigns)
          .where(and(eq(parentCampaigns.accountId, acct), inArray(parentCampaigns.id, parentIds)))
      : [],
  ]);
  const out = new Map<string, string>();
  for (const a of adSets) out.set(`campaign:${a.id}`, adSetPath(a.name));
  for (const p of parents) out.set(`parent_campaign:${p.id}`, campaignPath(p.network, p.name));
  return out;
}

export async function listAuditEvents(
  filters: AuditFeedFilters = {},
): Promise<AuditFeedRow[]> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const acct = await getActiveAccountId();
  const conds: SQL[] = [eq(auditEvents.accountId, acct)];
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
      actorAvatarUrl: users.avatarUrl,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(auditEvents.id))
    .limit(limit);

  const paths = await livePaths(acct, rows);

  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action as AuditAction,
    entityType: r.entityType,
    entityId: r.entityId,
    entityLabel: r.entityLabel,
    meta: (r.meta as Record<string, unknown> | null) ?? null,
    livePath: paths.get(`${r.entityType}:${r.entityId}`) ?? null,
    actor: r.actorId
      ? {
          id: r.actorId,
          name: r.actorName ?? "",
          email: r.actorEmail ?? "",
          avatarUrl: r.actorAvatarUrl ?? null,
        }
      : null,
  }));
}

/** Quick counts grouped by category for header chips. */
export async function auditCategoryCounts(): Promise<
  Array<{ category: string; count: number }>
> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      category: auditEvents.entityType,
      count: sql<number>`count(*)::int`,
    })
    .from(auditEvents)
    .where(eq(auditEvents.accountId, acct))
    .groupBy(auditEvents.entityType);
  return rows;
}
