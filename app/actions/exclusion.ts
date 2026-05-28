"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/auth";
import { creatives, performanceRecords } from "@/db/schema";
import { excludeSchema } from "@/validators/exclusion";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

const idSchema = z.coerce.number().int().positive();

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Flag a performance record as excluded from aggregates.
 * PRD §5.5: reason required, max 200 chars. Admin or Editor only.
 */
export async function excludeRecord(
  recordId: number,
  reason: string,
): Promise<ActionResult> {
  try {
    const user = await requireEditor();
    const id = idSchema.parse(recordId);
    const parsed = excludeSchema.parse({ reason });

    const [updated] = await db
      .update(performanceRecords)
      .set({
        excludedFromAggregates: true,
        excludedReason: parsed.reason,
        excludedByUserId: user.id,
        excludedAt: new Date(),
      })
      .where(eq(performanceRecords.id, id))
      .returning({
        creativeId: performanceRecords.creativeId,
        date: performanceRecords.date,
        platform: performanceRecords.platform,
      });

    if (!updated) {
      return { ok: false, error: "Record not found" };
    }

    const creativeName = await revalidateAffectedPaths(updated.creativeId);
    await logAudit({
      action: AUDIT_ACTIONS.EXCLUSION_EXCLUDE,
      entityType: "exclusion",
      entityId: String(id),
      entityLabel: creativeName ?? null,
      actorUserId: user.id,
      meta: {
        creativeId: updated.creativeId,
        date: updated.date,
        platform: updated.platform,
        reason: parsed.reason,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/** Clear the exclusion flag on a record. Preserves no history in v1. */
export async function includeRecord(recordId: number): Promise<ActionResult> {
  try {
    const user = await requireEditor();
    const id = idSchema.parse(recordId);

    const [updated] = await db
      .update(performanceRecords)
      .set({
        excludedFromAggregates: false,
        excludedReason: null,
        excludedByUserId: null,
        excludedAt: null,
      })
      .where(eq(performanceRecords.id, id))
      .returning({
        creativeId: performanceRecords.creativeId,
        date: performanceRecords.date,
        platform: performanceRecords.platform,
      });

    if (!updated) {
      return { ok: false, error: "Record not found" };
    }

    const creativeName = await revalidateAffectedPaths(updated.creativeId);
    await logAudit({
      action: AUDIT_ACTIONS.EXCLUSION_INCLUDE,
      entityType: "exclusion",
      entityId: String(id),
      entityLabel: creativeName ?? null,
      actorUserId: user.id,
      meta: {
        creativeId: updated.creativeId,
        date: updated.date,
        platform: updated.platform,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

async function revalidateAffectedPaths(creativeId: string): Promise<string | null> {
  // Bump every page whose KPIs include this record. Swallow errors so a
  // revalidate failure (e.g. test harness without a request context) doesn't
  // mask a successful DB write. Returns the creative name so the caller can
  // use it as the audit entity label without re-querying.
  try {
    revalidatePath("/");
    revalidatePath("/creatives");
    const [c] = await db
      .select({ name: creatives.name })
      .from(creatives)
      .where(eq(creatives.id, creativeId))
      .limit(1);
    if (c) {
      revalidatePath(`/creatives/${encodeURIComponent(c.name)}`);
      return c.name;
    }
    return null;
  } catch (err) {
    console.warn("revalidatePath failed; DB write already succeeded:", err);
    return null;
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unknown error";
}
