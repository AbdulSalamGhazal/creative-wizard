"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { ratingRules } from "@/db/schema";
import { RATING_RULES_ID, getRatingRules } from "@/db/queries/rating";
import { ratingRulesSchema } from "@/validators/rating";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

export interface RatingRulesResult {
  ok: boolean;
  error?: string;
}

/**
 * Update the global rating rules (the Summary Rate column config). Admin only.
 * Upserts the singleton row so it works even if the seed never ran. Audit-logs
 * the before/after so threshold changes are traceable.
 */
export async function updateRatingRules(
  input: unknown,
): Promise<RatingRulesResult> {
  try {
    const user = await requireAdmin();
    const parsed = ratingRulesSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid rating rules",
      };
    }
    const { minSpend, goodRoas, decentRoas } = parsed.data;

    const before = await getRatingRules();

    await db
      .insert(ratingRules)
      .values({
        id: RATING_RULES_ID,
        minSpend: String(minSpend),
        goodRoas: String(goodRoas),
        decentRoas: String(decentRoas),
        updatedAt: new Date(),
        updatedByUserId: user.id,
      })
      .onConflictDoUpdate({
        target: ratingRules.id,
        set: {
          minSpend: String(minSpend),
          goodRoas: String(goodRoas),
          decentRoas: String(decentRoas),
          updatedAt: new Date(),
          updatedByUserId: user.id,
        },
      });

    try {
      revalidatePath("/summary");
      revalidatePath("/admin/catalog");
    } catch (err) {
      console.warn("revalidatePath after rating-rules update failed:", err);
    }

    await logAudit({
      action: AUDIT_ACTIONS.RATING_UPDATE,
      entityType: "rating",
      entityId: null,
      entityLabel: `Good ≥ ${goodRoas}×, Decent ≥ ${decentRoas}×, min spend $${minSpend}`,
      actorUserId: user.id,
      meta: { before, after: { minSpend, goodRoas, decentRoas } },
    });

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
