import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  creatives,
  exclusionRules,
  performanceRecords,
  users,
} from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import type { ExclusionRuleTarget } from "@/lib/exclusion-rules";

/**
 * DB side of the exclusion-rules engine. Rules MATERIALIZE into
 * `performance_records.excluded_from_aggregates` with provenance
 * (`excluded_source='rule'` + `excluded_rule_id`) — no aggregate query changes.
 * apply/unapply are transactional and idempotent; both are also the ONLY code
 * (besides the manual exclusion action) allowed to flip the flag.
 */

/** db or a transaction handle — every mutator takes one so callers own the tx. */
type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ExclusionRuleRow extends ExclusionRuleTarget {
  id: string;
  active: boolean;
  note: string | null;
  createdAt: Date;
  createdByName: string | null;
  /** Resolved campaign/creative display name (null for objective rules). */
  targetLabel: string | null;
  /** Records currently excluded by this rule. */
  excludedCount: number;
}

export interface RuleImpactPreview {
  records: number;
  campaigns: number;
  creatives: number;
  from: string | null;
  to: string | null;
}

/** WHERE conditions selecting a rule's matching records (account-scoped). */
function ruleMatchConds(t: ExclusionRuleTarget, acct: string): SQL[] {
  const conds: SQL[] = [eq(performanceRecords.accountId, acct)];
  if (t.kind === "creative" && t.creativeId) {
    conds.push(eq(performanceRecords.creativeId, t.creativeId));
  } else if (t.kind === "campaign" && t.campaignId) {
    conds.push(eq(performanceRecords.campaignId, t.campaignId));
  } else if (t.kind === "campaign_objective" && t.objective) {
    conds.push(
      sql`${performanceRecords.campaignId} IN (
        SELECT ${campaigns.id} FROM ${campaigns}
        WHERE ${campaigns.accountId} = ${acct}
          AND ${campaigns.objective} = ${t.objective}
      )`,
    );
  } else {
    // Malformed target — match nothing (never "everything").
    conds.push(sql`false`);
  }
  return conds;
}

/**
 * Materialize a rule: flag its matching records that are NOT already excluded
 * (a manual exclusion, or another rule's, is never overwritten). Extra
 * conditions let the commit route scope stamping to one batch / id set.
 * Returns the number of rows flipped.
 */
export async function applyRule(
  exec: Exec,
  rule: ExclusionRuleTarget & { id: string },
  acct: string,
  extraConds: SQL[] = [],
): Promise<number> {
  const flipped = await exec
    .update(performanceRecords)
    .set({
      excludedFromAggregates: true,
      excludedSource: "rule",
      excludedRuleId: rule.id,
    })
    .where(
      and(
        ...ruleMatchConds(rule, acct),
        eq(performanceRecords.excludedFromAggregates, false),
        ...extraConds,
      ),
    )
    .returning({ id: performanceRecords.id });
  return flipped.length;
}

/**
 * Un-materialize a rule: clear the flag ONLY on rows this rule excluded
 * (`excluded_rule_id` = it). Manual exclusions and other rules' rows are
 * untouched by construction. Returns the number of rows restored.
 */
export async function unapplyRule(
  exec: Exec,
  ruleId: string,
  acct: string,
): Promise<number> {
  const restored = await exec
    .update(performanceRecords)
    .set({
      excludedFromAggregates: false,
      excludedSource: null,
      excludedRuleId: null,
    })
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.excludedRuleId, ruleId),
      ),
    )
    .returning({ id: performanceRecords.id });
  return restored.length;
}

/** What CREATING/ACTIVATING a rule would exclude (not-yet-excluded matches). */
export async function previewRuleApply(
  target: ExclusionRuleTarget,
): Promise<RuleImpactPreview> {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({
      records: sql<number>`count(*)::int`,
      campaigns: sql<number>`count(DISTINCT ${performanceRecords.campaignId})::int`,
      creatives: sql<number>`count(DISTINCT ${performanceRecords.creativeId})::int`,
      from: sql<string | null>`MIN(${performanceRecords.date})`,
      to: sql<string | null>`MAX(${performanceRecords.date})`,
    })
    .from(performanceRecords)
    .where(
      and(
        ...ruleMatchConds(target, acct),
        eq(performanceRecords.excludedFromAggregates, false),
      ),
    );
  return {
    records: Number(row?.records ?? 0),
    campaigns: Number(row?.campaigns ?? 0),
    creatives: Number(row?.creatives ?? 0),
    from: row?.from ?? null,
    to: row?.to ?? null,
  };
}

/** What DEACTIVATING/DELETING a rule would restore (its currently-flagged rows). */
export async function previewRuleUnapply(
  ruleId: string,
): Promise<RuleImpactPreview> {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({
      records: sql<number>`count(*)::int`,
      campaigns: sql<number>`count(DISTINCT ${performanceRecords.campaignId})::int`,
      creatives: sql<number>`count(DISTINCT ${performanceRecords.creativeId})::int`,
      from: sql<string | null>`MIN(${performanceRecords.date})`,
      to: sql<string | null>`MAX(${performanceRecords.date})`,
    })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.excludedRuleId, ruleId),
      ),
    );
  return {
    records: Number(row?.records ?? 0),
    campaigns: Number(row?.campaigns ?? 0),
    creatives: Number(row?.creatives ?? 0),
    from: row?.from ?? null,
    to: row?.to ?? null,
  };
}

/** One rule by id, account-scoped (guards every mutation). */
export async function getRule(id: string) {
  const acct = await getActiveAccountId();
  const [rule] = await db
    .select()
    .from(exclusionRules)
    .where(and(eq(exclusionRules.accountId, acct), eq(exclusionRules.id, id)))
    .limit(1);
  return rule ?? null;
}

/** Every rule for the active account, names resolved, with live excluded counts. */
export async function listExclusionRules(): Promise<ExclusionRuleRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: exclusionRules.id,
      kind: exclusionRules.kind,
      objective: exclusionRules.objective,
      campaignId: exclusionRules.campaignId,
      creativeId: exclusionRules.creativeId,
      active: exclusionRules.active,
      note: exclusionRules.note,
      createdAt: exclusionRules.createdAt,
      createdByName: users.name,
      campaignName: campaigns.name,
      creativeName: creatives.name,
      excludedCount: sql<number>`(
        SELECT count(*)::int FROM ${performanceRecords}
        WHERE ${performanceRecords.excludedRuleId} = ${exclusionRules.id}
      )`,
    })
    .from(exclusionRules)
    .leftJoin(users, eq(users.id, exclusionRules.createdByUserId))
    .leftJoin(campaigns, eq(campaigns.id, exclusionRules.campaignId))
    .leftJoin(creatives, eq(creatives.id, exclusionRules.creativeId))
    .where(eq(exclusionRules.accountId, acct))
    .orderBy(desc(exclusionRules.active), desc(exclusionRules.createdAt));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    objective: r.objective ?? null,
    campaignId: r.campaignId ?? null,
    creativeId: r.creativeId ?? null,
    active: r.active,
    note: r.note ?? null,
    createdAt: r.createdAt,
    createdByName: r.createdByName ?? null,
    targetLabel: r.campaignName ?? r.creativeName ?? null,
    excludedCount: Number(r.excludedCount ?? 0),
  }));
}

/** Active rules for ONE account, by explicit id (commit route runs pre-auth-context). */
export async function activeRulesFor(exec: Exec, accountId: string) {
  return exec
    .select()
    .from(exclusionRules)
    .where(and(eq(exclusionRules.accountId, accountId), eq(exclusionRules.active, true)));
}

/**
 * Stamp records against every ACTIVE rule — called inside the upload-commit
 * transaction so imported rows land already-excluded when a rule covers them.
 * `extraConds` scopes to the new batch (inserts) or an id list (upsert
 * re-stamp). Skips already-excluded rows like any apply. Returns total flipped.
 */
export async function stampAgainstActiveRules(
  exec: Exec,
  accountId: string,
  extraConds: SQL[],
): Promise<number> {
  const rules = await activeRulesFor(exec, accountId);
  let total = 0;
  for (const rule of rules) {
    total += await applyRule(exec, rule, accountId, extraConds);
  }
  return total;
}

/**
 * Delete every rule targeting a campaign/creative — for deleteCampaign /
 * deleteCreative (called inside their transactions AFTER the entity's records
 * are gone, so no `excluded_rule_id` still references the rule rows).
 */
export async function deleteRulesTargeting(
  exec: Exec,
  acct: string,
  target: { campaignId?: string; creativeId?: string },
): Promise<number> {
  const cond = target.campaignId
    ? eq(exclusionRules.campaignId, target.campaignId)
    : target.creativeId
      ? eq(exclusionRules.creativeId, target.creativeId)
      : null;
  if (!cond) return 0;
  const deleted = await exec
    .delete(exclusionRules)
    .where(and(eq(exclusionRules.accountId, acct), cond))
    .returning({ id: exclusionRules.id });
  return deleted.length;
}

/** The rule that excluded a record (for the manual-un-exclude guard message). */
export async function ruleExcludingRecord(recordId: number): Promise<{
  id: string;
  kind: ExclusionRuleTarget["kind"];
  objective: string | null;
  targetLabel: string | null;
} | null> {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({
      id: exclusionRules.id,
      kind: exclusionRules.kind,
      objective: exclusionRules.objective,
      campaignName: campaigns.name,
      creativeName: creatives.name,
    })
    .from(performanceRecords)
    .innerJoin(exclusionRules, eq(exclusionRules.id, performanceRecords.excludedRuleId))
    .leftJoin(campaigns, eq(campaigns.id, exclusionRules.campaignId))
    .leftJoin(creatives, eq(creatives.id, exclusionRules.creativeId))
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.id, recordId),
        eq(performanceRecords.excludedSource, "rule"),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    objective: row.objective ?? null,
    targetLabel: row.campaignName ?? row.creativeName ?? null,
  };
}
