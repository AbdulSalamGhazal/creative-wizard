"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { creatives, creativeAngles, angles } from "@/db/schema";
import { getAngle } from "@/db/queries/angles";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getActiveAccountId } from "@/lib/tenant";

export interface AngleMutationResult {
  ok: boolean;
  error?: string;
}

// Angle names mirror the creative_angles column: 1–64 chars, trimmed.
const nameSchema = z.string().trim().min(1, "Name is required").max(64);

function revalidate() {
  try {
    revalidatePath("/admin/catalog");
    revalidatePath("/creatives");
  } catch (err) {
    console.warn("revalidatePath after angle mutation failed:", err);
  }
}

/** Add an angle to the managed vocabulary. Admin only. */
export async function createAngle(input: unknown): Promise<AngleMutationResult> {
  try {
    const user = await requirePermission("catalog.angles");
    const parsed = nameSchema.safeParse(
      typeof input === "object" && input !== null
        ? (input as { name?: unknown }).name
        : input,
    );
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name" };
    }
    const name = parsed.data;
    const acct = await getActiveAccountId();

    const [existing] = await db
      .select({ id: angles.id })
      .from(angles)
      .where(and(eq(angles.accountId, acct), eq(angles.name, name)))
      .limit(1);
    if (existing) return { ok: false, error: "That angle already exists." };

    const [inserted] = await db
      .insert(angles)
      .values({ accountId: acct, name, createdByUserId: user.id })
      .returning({ id: angles.id });

    revalidate();
    if (inserted) {
      await logAudit({
        action: AUDIT_ACTIONS.ANGLE_CREATE,
        entityType: "angle",
        entityId: inserted.id,
        entityLabel: name,
        actorUserId: user.id,
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Rename a vocabulary angle. The new name cascades to every creative_angles
 * assignment so creatives already carrying the angle follow the rename.
 */
export async function renameAngle(
  id: string,
  newName: string,
): Promise<AngleMutationResult> {
  try {
    const user = await requirePermission("catalog.angles");
    const parsed = nameSchema.safeParse(newName);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name" };
    }
    const next = parsed.data;
    const acct = await getActiveAccountId();

    const angle = await getAngle(id);
    if (!angle) return { ok: false, error: "Angle not found." };
    if (angle.name === next) return { ok: true };

    const [clash] = await db
      .select({ id: angles.id })
      .from(angles)
      .where(and(eq(angles.accountId, acct), eq(angles.name, next)))
      .limit(1);
    if (clash) return { ok: false, error: "Another angle already uses that name." };

    // Subquery of this account's creative ids — scopes the cascade so an angle
    // string shared with another brand can't be renamed across tenants.
    const acctCreatives = db
      .select({ id: creatives.id })
      .from(creatives)
      .where(eq(creatives.accountId, acct));

    await db.transaction(async (tx) => {
      await tx.update(angles).set({ name: next }).where(eq(angles.id, id));
      // Cascade to assignments — but ONLY for this account's creatives.
      await tx
        .update(creativeAngles)
        .set({ angle: next })
        .where(
          and(
            eq(creativeAngles.angle, angle.name),
            inArray(creativeAngles.creativeId, acctCreatives),
          ),
        );
    });

    revalidate();
    await logAudit({
      action: AUDIT_ACTIONS.ANGLE_RENAME,
      entityType: "angle",
      entityId: id,
      entityLabel: next,
      actorUserId: user.id,
      meta: { from: angle.name, to: next },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Delete a vocabulary angle and remove it from every creative that carries it.
 * Admin only.
 */
export async function deleteAngle(id: string): Promise<AngleMutationResult> {
  try {
    const user = await requirePermission("catalog.angles");
    const acct = await getActiveAccountId();
    const angle = await getAngle(id);
    if (!angle) return { ok: false, error: "Angle not found." };

    // Scope the assignment removal to this account's creatives so a shared angle
    // string doesn't get stripped from another brand's creatives.
    const acctCreatives = db
      .select({ id: creatives.id })
      .from(creatives)
      .where(eq(creatives.accountId, acct));

    const removed = await db.transaction(async (tx) => {
      const r = await tx
        .delete(creativeAngles)
        .where(
          and(
            eq(creativeAngles.angle, angle.name),
            inArray(creativeAngles.creativeId, acctCreatives),
          ),
        )
        .returning({ creativeId: creativeAngles.creativeId });
      await tx.delete(angles).where(eq(angles.id, id));
      return r.length;
    });

    revalidate();
    await logAudit({
      action: AUDIT_ACTIONS.ANGLE_DELETE,
      entityType: "angle",
      entityId: id,
      entityLabel: angle.name,
      actorUserId: user.id,
      meta: { removedFromCreatives: removed },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
