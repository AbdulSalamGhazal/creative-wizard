"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { platformRatingRules, ratingRules } from "@/db/schema";
import { RATING_RULES_ID, getRatingRules } from "@/db/queries/rating";
import {
  clearPlatformRatingSchema,
  platformRatingRulesSchema,
  ratingRulesSchema,
} from "@/validators/rating";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

function revalidateRating() {
  try {
    revalidatePath("/summary");
    revalidatePath("/admin/catalog");
  } catch (err) {
    console.warn("revalidatePath after rating update failed:", err);
  }
}

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

/**
 * Upsert a per-platform rating override (admin only). The platform then rates
 * by these thresholds instead of the default; the blended total and other
 * platforms are unaffected.
 */
export async function updatePlatformRatingRules(
  input: unknown,
): Promise<RatingRulesResult> {
  try {
    const user = await requireAdmin();
    const parsed = platformRatingRulesSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid rating rules",
      };
    }
    const { platform, minSpend, goodRoas, decentRoas } = parsed.data;

    await db
      .insert(platformRatingRules)
      .values({
        platform,
        minSpend: String(minSpend),
        goodRoas: String(goodRoas),
        decentRoas: String(decentRoas),
        updatedAt: new Date(),
        updatedByUserId: user.id,
      })
      .onConflictDoUpdate({
        target: platformRatingRules.platform,
        set: {
          minSpend: String(minSpend),
          goodRoas: String(goodRoas),
          decentRoas: String(decentRoas),
          updatedAt: new Date(),
          updatedByUserId: user.id,
        },
      });

    revalidateRating();
    await logAudit({
      action: AUDIT_ACTIONS.RATING_UPDATE,
      entityType: "rating",
      entityId: null,
      entityLabel: `${platform}: Good ≥ ${goodRoas}×, Decent ≥ ${decentRoas}×, min $${minSpend}`,
      actorUserId: user.id,
      meta: { platform, minSpend, goodRoas, decentRoas },
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Remove a platform's override so it reverts to the default rating rules.
 */
export async function clearPlatformRatingRules(
  input: unknown,
): Promise<RatingRulesResult> {
  try {
    const user = await requireAdmin();
    const parsed = clearPlatformRatingSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid platform" };
    const { platform } = parsed.data;

    await db
      .delete(platformRatingRules)
      .where(eq(platformRatingRules.platform, platform));

    revalidateRating();
    await logAudit({
      action: AUDIT_ACTIONS.RATING_UPDATE,
      entityType: "rating",
      entityId: null,
      entityLabel: `${platform}: reverted to default rating rules`,
      actorUserId: user.id,
      meta: { platform, cleared: true },
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
