"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { campaigns, creatives, exclusionRules } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { CAMPAIGN_OBJECTIVES } from "@/lib/campaign";
import {
  ruleDescriptor,
  validateRuleTarget,
  type ExclusionRuleTarget,
} from "@/lib/exclusion-rules";
import {
  applyRule,
  unapplyRule,
  resweepActiveRules,
  previewRuleApply,
  previewRuleUnapply,
  getRule,
  type RuleImpactPreview,
} from "@/db/queries/exclusion-rules";

/**
 * Exclusion-rule mutations. Reuses `record.exclude` (a rule is bulk exclusion),
 * with guardrails: every mutation is preview-then-confirm in the UI, all
 * transactional, all audited with the counts the engine ACTUALLY flipped.
 */

const targetSchema = z
  .object({
    kind: z.enum(["campaign_objective", "campaign", "creative"]),
    objective: z.enum(CAMPAIGN_OBJECTIVES).nullish(),
    campaignId: z.string().uuid().nullish(),
    creativeId: z.string().uuid().nullish(),
  })
  .transform(
    (t): ExclusionRuleTarget => ({
      kind: t.kind,
      objective: t.objective ?? null,
      campaignId: t.campaignId ?? null,
      creativeId: t.creativeId ?? null,
    }),
  );

const createSchema = z.object({
  target: targetSchema,
  note: z.string().trim().max(200).optional(),
});

export interface RulePreviewResult {
  ok: boolean;
  error?: string;
  preview?: RuleImpactPreview;
}

export interface RuleMutationResult {
  ok: boolean;
  error?: string;
  /** Rows the engine actually flipped (excluded or restored). */
  affected?: number;
}

/** Resolve + ownership-check the target's display name (account-scoped). */
async function resolveTargetLabel(
  t: ExclusionRuleTarget,
  acct: string,
): Promise<{ ok: true; label: string | null } | { ok: false; error: string }> {
  if (t.kind === "campaign" && t.campaignId) {
    const [c] = await db
      .select({ name: campaigns.name })
      .from(campaigns)
      .where(and(eq(campaigns.accountId, acct), eq(campaigns.id, t.campaignId)))
      .limit(1);
    return c ? { ok: true, label: c.name } : { ok: false, error: "Campaign not found." };
  }
  if (t.kind === "creative" && t.creativeId) {
    const [c] = await db
      .select({ name: creatives.name })
      .from(creatives)
      .where(and(eq(creatives.accountId, acct), eq(creatives.id, t.creativeId)))
      .limit(1);
    return c ? { ok: true, label: c.name } : { ok: false, error: "Creative not found." };
  }
  return { ok: true, label: null };
}

/** Server-computed impact for the create/activate confirm dialog. Read-only. */
export async function previewExclusionRule(input: unknown): Promise<RulePreviewResult> {
  try {
    await requirePermission("record.exclude");
    const parsed = targetSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid rule target." };
    const targetErr = validateRuleTarget(parsed.data);
    if (targetErr) return { ok: false, error: targetErr };
    return { ok: true, preview: await previewRuleApply(parsed.data) };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

export async function createExclusionRule(input: unknown): Promise<RuleMutationResult> {
  try {
    const user = await requirePermission("record.exclude");
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid rule." };
    const { target, note } = parsed.data;
    const targetErr = validateRuleTarget(target);
    if (targetErr) return { ok: false, error: targetErr };
    const acct = await getActiveAccountId();

    const resolved = await resolveTargetLabel(target, acct);
    if (!resolved.ok) return { ok: false, error: resolved.error };

    const { ruleId, affected } = await db.transaction(async (tx) => {
      const [rule] = await tx
        .insert(exclusionRules)
        .values({
          accountId: acct,
          kind: target.kind,
          // Narrow back to the enum — the zod schema already validated it.
          objective: target.objective as (typeof CAMPAIGN_OBJECTIVES)[number] | null,
          campaignId: target.campaignId,
          creativeId: target.creativeId,
          note: note || null,
          createdByUserId: user.id,
        })
        .returning({ id: exclusionRules.id });
      const flipped = await applyRule(tx, { ...target, id: rule!.id }, acct);
      return { ruleId: rule!.id, affected: flipped };
    });

    revalidateEverything();
    await logAudit({
      action: AUDIT_ACTIONS.EXCLUSION_RULE_CREATE,
      entityType: "exclusion",
      entityId: ruleId,
      entityLabel: ruleDescriptor(target, resolved.label),
      actorUserId: user.id,
      meta: { ...target, note: note || null, excluded: affected },
    });
    return { ok: true, affected };
  } catch (err) {
    const msg = errMsg(err);
    if (/duplicate key|unique/i.test(msg)) {
      return { ok: false, error: "A rule for that target already exists." };
    }
    return { ok: false, error: msg };
  }
}

export async function toggleExclusionRule(input: unknown): Promise<RuleMutationResult> {
  try {
    const user = await requirePermission("record.exclude");
    const parsed = z
      .object({ id: z.string().uuid(), active: z.boolean() })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid input." };
    const { id, active } = parsed.data;
    const acct = await getActiveAccountId();
    const rule = await getRule(id);
    if (!rule) return { ok: false, error: "Rule not found." };
    if (rule.active === active) return { ok: true, affected: 0 };

    const affected = await db.transaction(async (tx) => {
      await tx
        .update(exclusionRules)
        .set({ active })
        .where(and(eq(exclusionRules.accountId, acct), eq(exclusionRules.id, id)));
      if (active) return applyRule(tx, rule, acct);
      const restored = await unapplyRule(tx, id, acct);
      // Rows also covered by another active rule get re-stamped, not released.
      const restamped = await resweepActiveRules(tx, acct);
      return restored - restamped;
    });

    revalidateEverything();
    const resolved = await resolveTargetLabel(rule, acct);
    await logAudit({
      action: AUDIT_ACTIONS.EXCLUSION_RULE_TOGGLE,
      entityType: "exclusion",
      entityId: id,
      entityLabel: ruleDescriptor(rule, resolved.ok ? resolved.label : null),
      actorUserId: user.id,
      meta: { active, affected },
    });
    return { ok: true, affected };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

export async function deleteExclusionRule(input: unknown): Promise<RuleMutationResult> {
  try {
    const user = await requirePermission("record.exclude");
    const parsed = z.string().uuid().safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid rule id." };
    const acct = await getActiveAccountId();
    const rule = await getRule(parsed.data);
    if (!rule) return { ok: false, error: "Rule not found." };

    const affected = await db.transaction(async (tx) => {
      const restored = await unapplyRule(tx, rule.id, acct);
      await tx
        .delete(exclusionRules)
        .where(and(eq(exclusionRules.accountId, acct), eq(exclusionRules.id, rule.id)));
      // Rows also covered by another active rule get re-stamped, not released.
      const restamped = await resweepActiveRules(tx, acct);
      return restored - restamped;
    });

    revalidateEverything();
    const resolved = await resolveTargetLabel(rule, acct);
    await logAudit({
      action: AUDIT_ACTIONS.EXCLUSION_RULE_DELETE,
      entityType: "exclusion",
      entityId: rule.id,
      entityLabel: ruleDescriptor(rule, resolved.ok ? resolved.label : null),
      actorUserId: user.id,
      meta: { restored: affected },
    });
    return { ok: true, affected };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/** Server-computed impact for the deactivate/delete confirm dialog. */
export async function previewExclusionRuleRemoval(
  input: unknown,
): Promise<RulePreviewResult> {
  try {
    await requirePermission("record.exclude");
    const parsed = z.string().uuid().safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid rule id." };
    const rule = await getRule(parsed.data);
    if (!rule) return { ok: false, error: "Rule not found." };
    return { ok: true, preview: await previewRuleUnapply(rule.id) };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/** Rules change aggregates on every analytics page — bump the whole layout. */
function revalidateEverything() {
  try {
    revalidatePath("/", "layout");
  } catch (err) {
    console.warn("revalidatePath after rule change failed:", err);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}
