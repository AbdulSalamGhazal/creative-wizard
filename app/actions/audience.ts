"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { audienceSnapshots } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { actionError } from "@/lib/action-error";
import { todayIso } from "@/lib/date-presets";
import { stageLabel } from "@/lib/audience";
import { PLATFORM_LABEL } from "@/lib/palette";
import {
  deleteAudienceSchema,
  recordAudienceSchema,
  updateAudienceSchema,
} from "@/validators/audience";

/**
 * Funnel-audience mutations — permission `audience.manage` (deliberately NOT in
 * the editor preset: entering measurements and planning budgets are different
 * jobs), all audited.
 *
 * Recording is an UPSERT on (account, platform, stage, date): measuring the
 * same audience twice on one day is a correction, not a second truth.
 */

export interface AudienceActionResult {
  ok: boolean;
  error?: string;
  /** How many measurements the record wrote (inserted or corrected). */
  recorded?: number;
}

function errMsg(err: unknown): string {
  return actionError(err, "audience");
}

function revalidateAudience() {
  try {
    revalidatePath("/budget/audience");
  } catch (err) {
    console.warn("revalidatePath after audience change failed:", err);
  }
}

/**
 * Record one date's measurements. Entries the user didn't touch are simply not
 * sent, so a single cell is a complete record — the dialog never forces a full
 * matrix. Backfilling an earlier date is normal (that is how a weekly
 * measurement gets entered); the future is not.
 */
export async function recordAudienceSnapshots(
  input: unknown,
): Promise<AudienceActionResult> {
  try {
    const user = await requirePermission("audience.manage");
    const parsed = recordAudienceSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid measurement" };
    }
    const { date, entries } = parsed.data;

    if (date > todayIso()) {
      return { ok: false, error: "An audience can't be measured in the future." };
    }

    // The unique index would refuse anyway — say it in words first.
    const pairs = new Set(entries.map((e) => `${e.platform}|${e.stage}`));
    if (pairs.size !== entries.length) {
      return { ok: false, error: "The same platform × stage twice in one record." };
    }

    const acct = await getActiveAccountId();
    await db
      .insert(audienceSnapshots)
      .values(
        entries.map((e) => ({
          accountId: acct,
          platform: e.platform,
          stage: e.stage,
          date,
          size: e.size,
          createdBy: user.id,
        })),
      )
      .onConflictDoUpdate({
        target: [
          audienceSnapshots.accountId,
          audienceSnapshots.platform,
          audienceSnapshots.stage,
          audienceSnapshots.date,
        ],
        // Re-measuring a pair on a date it already has is a CORRECTION: the
        // row keeps its identity and takes the new number, the new author and
        // the new timestamp. `excluded` is the row this statement tried to
        // insert, so one statement handles every entry.
        set: {
          size: sql`excluded.size`,
          createdBy: sql`excluded.created_by`,
          createdAt: sql`excluded.created_at`,
        },
      });

    revalidateAudience();
    await logAudit({
      action: AUDIT_ACTIONS.AUDIENCE_RECORD,
      entityType: "audience",
      entityId: date,
      entityLabel: `Audience sizes for ${date}`,
      actorUserId: user.id,
      meta: { date, entries: entries.length },
    });
    return { ok: true, recorded: entries.length };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/** Correct one stored measurement (a typo, usually). */
export async function updateAudienceSnapshot(
  input: unknown,
): Promise<AudienceActionResult> {
  try {
    const user = await requirePermission("audience.manage");
    const parsed = updateAudienceSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid size" };
    }
    const acct = await getActiveAccountId();
    // Account-scoped by the WHERE, not by the id alone — an id from another
    // brand simply matches nothing.
    const [row] = await db
      .update(audienceSnapshots)
      .set({ size: parsed.data.size, createdBy: user.id })
      .where(
        and(
          eq(audienceSnapshots.id, parsed.data.id),
          eq(audienceSnapshots.accountId, acct),
        ),
      )
      .returning({
        platform: audienceSnapshots.platform,
        stage: audienceSnapshots.stage,
        date: audienceSnapshots.date,
      });
    if (!row) return { ok: false, error: "That measurement no longer exists." };

    revalidateAudience();
    await logAudit({
      action: AUDIT_ACTIONS.AUDIENCE_UPDATE,
      entityType: "audience",
      entityId: parsed.data.id,
      entityLabel: `${PLATFORM_LABEL[row.platform]} · ${stageLabel(row.stage)} · ${row.date}`,
      actorUserId: user.id,
      meta: { date: row.date, platform: row.platform, stage: row.stage, size: parsed.data.size },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/** Delete one measurement — a mis-dated entry, not a way to clear history. */
export async function deleteAudienceSnapshot(
  input: unknown,
): Promise<AudienceActionResult> {
  try {
    const user = await requirePermission("audience.manage");
    const parsed = deleteAudienceSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Invalid measurement." };
    }
    const acct = await getActiveAccountId();
    const [row] = await db
      .delete(audienceSnapshots)
      .where(
        and(
          eq(audienceSnapshots.id, parsed.data.id),
          eq(audienceSnapshots.accountId, acct),
        ),
      )
      .returning({
        platform: audienceSnapshots.platform,
        stage: audienceSnapshots.stage,
        date: audienceSnapshots.date,
        size: audienceSnapshots.size,
      });
    if (!row) return { ok: false, error: "That measurement no longer exists." };

    revalidateAudience();
    await logAudit({
      action: AUDIT_ACTIONS.AUDIENCE_DELETE,
      entityType: "audience",
      entityId: parsed.data.id,
      entityLabel: `${PLATFORM_LABEL[row.platform]} · ${stageLabel(row.stage)} · ${row.date}`,
      actorUserId: user.id,
      meta: { date: row.date, platform: row.platform, stage: row.stage, size: row.size },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}
