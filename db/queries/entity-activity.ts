import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEventEntities, auditEvents, performanceRecords, users } from "@/db/schema";
import { AUDIT_ACTIONS, type AuditAction } from "@/lib/audit";
import type { AuditFeedRow } from "@/db/queries/audit";
import { getActiveAccountId, getActiveStatusWindowHours } from "@/lib/tenant";
import { platformSpendFreshness } from "@/db/queries/creative-status";
import { hoursToWindowDays, type Platform } from "@/lib/creative-status";
import {
  ENTITY_ACTIVITY_PAGE,
  statusEvents,
  type EntityActivityType,
  type StatusEvent,
} from "@/lib/entity-activity";

const EXCLUSION_ACTIONS: readonly AuditAction[] = [
  AUDIT_ACTIONS.EXCLUSION_EXCLUDE,
  AUDIT_ACTIONS.EXCLUSION_INCLUDE,
  AUDIT_ACTIONS.EXCLUSION_RULE_CREATE,
  AUDIT_ACTIONS.EXCLUSION_RULE_TOGGLE,
  AUDIT_ACTIONS.EXCLUSION_RULE_DELETE,
];

/**
 * WHAT BELONGS in an entity's Activity (user decision, 2026-11-07): what was
 * done TO it — its own edits and the exclusions on its records — never what
 * merely touched its data. An upload, a rollback, a cleanup, the OTHER side's
 * delete, an angle renamed on the Angles page and a campaign edit that
 * re-swept rules are all linked (`audit_event_entities` records every touch)
 * but are not shown: "why would we list activity not related to the entity?"
 * A budget month's is its plan's history alone. Derived from AUDIT_ACTIONS,
 * so a renamed action can't silently fall out.
 */
export const ENTITY_ACTIVITY_ACTIONS: Record<EntityActivityType, readonly AuditAction[]> = {
  creative: [
    AUDIT_ACTIONS.CREATIVE_CREATE,
    AUDIT_ACTIONS.CREATIVE_BULK_CREATE,
    AUDIT_ACTIONS.CREATIVE_UPDATE,
    AUDIT_ACTIONS.CREATIVE_NOTES_UPDATE,
    AUDIT_ACTIONS.CREATIVE_SOURCE_UPDATE,
    AUDIT_ACTIONS.CREATIVE_DELETE,
    ...EXCLUSION_ACTIONS,
  ],
  campaign: [
    AUDIT_ACTIONS.CAMPAIGN_CREATE,
    AUDIT_ACTIONS.CAMPAIGN_UPDATE,
    AUDIT_ACTIONS.CAMPAIGN_DELETE,
    ...EXCLUSION_ACTIONS,
  ],
  budget_month: [AUDIT_ACTIONS.BUDGET_UPDATE],
  ps_version: [
    AUDIT_ACTIONS.PS_VERSION_CREATE,
    AUDIT_ACTIONS.PS_VERSION_IMPORT,
    AUDIT_ACTIONS.PS_VERSION_EDIT,
    AUDIT_ACTIONS.PS_VERSION_DELETE,
  ],
};

/**
 * One entity's Activity (2026-11-07): the audit events done TO it — on its
 * page or anywhere else — newest first, through the
 * `audit_event_entities` links (read index: account, type, id, event id DESC).
 * Brand-scoped: an id from another brand simply has no links here.
 */
export async function entityActivityPage(
  type: EntityActivityType,
  id: string,
  beforeId: number | null,
): Promise<{ rows: AuditFeedRow[]; hasMore: boolean }> {
  const acct = await getActiveAccountId();
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
    .from(auditEventEntities)
    .innerJoin(auditEvents, eq(auditEvents.id, auditEventEntities.auditEventId))
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(
      and(
        eq(auditEventEntities.accountId, acct),
        eq(auditEventEntities.entityType, type),
        eq(auditEventEntities.entityId, id),
        // Only what was done TO it (ENTITY_ACTIVITY_ACTIONS).
        inArray(auditEvents.action, [...ENTITY_ACTIVITY_ACTIONS[type]]),
        beforeId === null ? undefined : lt(auditEventEntities.auditEventId, beforeId),
      ),
    )
    .orderBy(desc(auditEventEntities.auditEventId))
    .limit(ENTITY_ACTIVITY_PAGE + 1);

  const hasMore = rows.length > ENTITY_ACTIVITY_PAGE;
  return {
    hasMore,
    rows: rows.slice(0, ENTITY_ACTIVITY_PAGE).map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action as AuditAction,
      entityType: r.entityType,
      entityId: r.entityId,
      entityLabel: r.entityLabel,
      meta: (r.meta as Record<string, unknown> | null) ?? null,
      actor: r.actorId
        ? {
            id: r.actorId,
            name: r.actorName ?? "",
            email: r.actorEmail ?? "",
            avatarUrl: r.actorAvatarUrl ?? null,
          }
        : null,
    })),
  };
}

/**
 * "Went live" / "stopped" per platform for a creative or campaign — derived,
 * never stored, by the status badge's own rule (`statusEvents`). One bounded
 * scan of the entity's spend days (spend > 0, not excluded — the same inputs
 * as `brandStatusInputs`) plus the cached per-platform freshness. A budget
 * month has no status.
 */
export async function entityStatusEvents(
  type: EntityActivityType,
  id: string,
): Promise<StatusEvent[]> {
  if (type === "budget_month" || type === "ps_version") return [];
  const [acct, windowHours, latestDayByPlatform] = await Promise.all([
    getActiveAccountId(),
    getActiveStatusWindowHours(),
    platformSpendFreshness(),
  ]);
  const rows = await db
    .selectDistinct({
      platform: performanceRecords.platform,
      day: sql<string>`${performanceRecords.date}::text`,
    })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        type === "creative"
          ? eq(performanceRecords.creativeId, id)
          : eq(performanceRecords.campaignId, id),
        eq(performanceRecords.excludedFromAggregates, false),
        sql`${performanceRecords.spend} > 0`,
      ),
    );
  const days: Partial<Record<Platform, string[]>> = {};
  for (const r of rows) (days[r.platform as Platform] ??= []).push(r.day);
  return statusEvents(days, latestDayByPlatform, hoursToWindowDays(windowHours));
}
