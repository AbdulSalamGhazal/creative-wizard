"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/auth";
import {
  creatives,
  creativeStatusEnum,
  creativeTags,
  creativeTypeEnum,
  performanceRecords,
} from "@/db/schema";
import { creativeCreateSchema } from "@/validators/creative";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

export interface CreativeMutationResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  name?: string;
}

export async function createCreative(
  input: unknown,
): Promise<CreativeMutationResult> {
  try {
    const user = await requireEditor();
    const parsed = creativeCreateSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString() ?? "_";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { ok: false, error: "Invalid input", fieldErrors };
    }
    const data = parsed.data;

    // Name uniqueness pre-check (DB will enforce, but a clean message helps).
    const existing = await db
      .select({ id: creatives.id })
      .from(creatives)
      .where(eq(creatives.name, data.name))
      .limit(1);
    if (existing.length > 0) {
      return {
        ok: false,
        error: "A creative with that name already exists.",
        fieldErrors: { name: "Already in use" },
      };
    }

    const [inserted] = await db
      .insert(creatives)
      .values({
        name: data.name,
        productId: data.productId,
        type: data.type,
        status: data.status,
        thumbnailUrl: data.thumbnailUrl,
        launchDate: data.launchDate,
        notes: data.notes,
        createdByUserId: user.id,
      })
      .returning({ id: creatives.id, name: creatives.name });

    if (!inserted) return { ok: false, error: "Insert failed." };

    if (data.tags.length > 0) {
      await db
        .insert(creativeTags)
        .values(data.tags.map((tag) => ({ creativeId: inserted.id, tag })))
        .onConflictDoNothing();
    }

    try {
      revalidatePath("/creatives");
    } catch (err) {
      console.warn("revalidatePath after create failed:", err);
    }

    await logAudit({
      action: AUDIT_ACTIONS.CREATIVE_CREATE,
      entityType: "creative",
      entityId: inserted.id,
      entityLabel: inserted.name,
      actorUserId: user.id,
      meta: {
        productId: data.productId,
        type: data.type,
        status: data.status,
        tags: data.tags,
      },
    });

    return { ok: true, name: inserted.name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function updateCreativeNotes(
  creativeId: string,
  notes: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requireEditor();
    if (notes.length > 5000) {
      return { ok: false, error: "Notes too long (5000 char max)." };
    }
    const [updated] = await db
      .update(creatives)
      .set({ notes: notes || null, updatedAt: new Date() })
      .where(eq(creatives.id, creativeId))
      .returning({ id: creatives.id, name: creatives.name });
    try {
      revalidatePath("/creatives");
    } catch (err) {
      console.warn("revalidatePath after notes update failed:", err);
    }
    if (updated) {
      await logAudit({
        action: AUDIT_ACTIONS.CREATIVE_NOTES_UPDATE,
        entityType: "creative",
        entityId: updated.id,
        entityLabel: updated.name,
        actorUserId: user.id,
        meta: { length: notes.length },
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Bulk-change status across N creatives. Used by the Library's bulk-action
 * bar; admin-or-editor only.
 */
const bulkStatusSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  status: z.enum(creativeStatusEnum),
});

export async function bulkUpdateStatus(input: unknown): Promise<
  CreativeMutationResult & { updated?: number }
> {
  try {
    const user = await requireEditor();
    const parsed = bulkStatusSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }

    const result = await db
      .update(creatives)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(inArray(creatives.id, parsed.data.ids))
      .returning({ id: creatives.id, name: creatives.name });

    try {
      revalidatePath("/creatives");
    } catch (err) {
      console.warn("revalidatePath after bulk update failed:", err);
    }

    await logAudit({
      action: AUDIT_ACTIONS.CREATIVE_STATUS_BULK,
      entityType: "creative",
      entityId: null,
      entityLabel: `${result.length} creative${result.length === 1 ? "" : "s"}`,
      actorUserId: user.id,
      meta: {
        status: parsed.data.status,
        count: result.length,
        names: result.map((r) => r.name).slice(0, 25),
      },
    });

    return { ok: true, updated: result.length };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Inline edit from the creative detail page — the single save path for every
 * editable field (name / product / type / status / thumbnail / launch date /
 * tags). Every field is optional; only the fields actually present in the
 * payload are written. Tags, when provided, replace the whole set (wipe +
 * reinsert in one transaction). Renaming is validated for uniqueness, exactly
 * like the old full-edit form — the detail page now edits everything in place,
 * so there is no separate `/edit` route.
 *
 * Notes are NOT handled here — they have their own inline editor
 * (`updateCreativeNotes` via NotesPanel), so this never clobbers them.
 */
const creativePatchSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(255).optional(),
    productId: z.string().uuid().optional(),
    type: z.enum(creativeTypeEnum).optional(),
    status: z.enum(creativeStatusEnum).optional(),
    thumbnailUrl: z.string().url().nullable().optional(),
    launchDate: z
      .string()
      .date()
      .nullable()
      .optional()
      .transform((v) => (v ? v : v === null ? null : undefined)),
    tags: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.productId !== undefined ||
      d.type !== undefined ||
      d.status !== undefined ||
      d.thumbnailUrl !== undefined ||
      d.launchDate !== undefined ||
      d.tags !== undefined,
    { message: "No fields to update." },
  );

export async function patchCreative(
  input: unknown,
): Promise<CreativeMutationResult> {
  try {
    const user = await requireEditor();
    const parsed = creativePatchSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString() ?? "_";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
        fieldErrors,
      };
    }
    const data = parsed.data;

    const [oldRow] = await db
      .select({
        name: creatives.name,
        productId: creatives.productId,
        type: creatives.type,
        status: creatives.status,
        thumbnailUrl: creatives.thumbnailUrl,
        launchDate: creatives.launchDate,
      })
      .from(creatives)
      .where(eq(creatives.id, data.id))
      .limit(1);
    if (!oldRow) return { ok: false, error: "Creative not found." };

    // Name uniqueness — only when actually renaming.
    if (data.name !== undefined && data.name !== oldRow.name) {
      const [collision] = await db
        .select({ id: creatives.id })
        .from(creatives)
        .where(and(eq(creatives.name, data.name), ne(creatives.id, data.id)))
        .limit(1);
      if (collision) {
        return {
          ok: false,
          error: "A creative with that name already exists.",
          fieldErrors: { name: "Already in use" },
        };
      }
    }

    // Build a set clause from only the provided scalar fields.
    const set: Partial<typeof creatives.$inferInsert> = { updatedAt: new Date() };
    if (data.name !== undefined) set.name = data.name;
    if (data.productId !== undefined) set.productId = data.productId;
    if (data.type !== undefined) set.type = data.type;
    if (data.status !== undefined) set.status = data.status;
    if (data.thumbnailUrl !== undefined) set.thumbnailUrl = data.thumbnailUrl;
    if (data.launchDate !== undefined) set.launchDate = data.launchDate;
    const hasScalarChange = Object.keys(set).length > 1; // more than updatedAt

    await db.transaction(async (tx) => {
      if (hasScalarChange) {
        await tx.update(creatives).set(set).where(eq(creatives.id, data.id));
      }
      if (data.tags !== undefined) {
        await tx.delete(creativeTags).where(eq(creativeTags.creativeId, data.id));
        if (data.tags.length > 0) {
          await tx
            .insert(creativeTags)
            .values(data.tags.map((tag) => ({ creativeId: data.id, tag })))
            .onConflictDoNothing();
        }
      }
    });

    const newName = data.name ?? oldRow.name;
    try {
      revalidatePath("/creatives");
      revalidatePath(`/creatives/${encodeURIComponent(oldRow.name)}`);
      if (newName !== oldRow.name) {
        revalidatePath(`/creatives/${encodeURIComponent(newName)}`);
      }
    } catch (err) {
      console.warn("revalidatePath after patch failed:", err);
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (data.name !== undefined && oldRow.name !== data.name) {
      changes.name = { from: oldRow.name, to: data.name };
    }
    if (data.productId !== undefined && oldRow.productId !== data.productId) {
      changes.productId = { from: oldRow.productId, to: data.productId };
    }
    if (data.type !== undefined && oldRow.type !== data.type) {
      changes.type = { from: oldRow.type, to: data.type };
    }
    if (data.status !== undefined && oldRow.status !== data.status) {
      changes.status = { from: oldRow.status, to: data.status };
    }
    if (data.thumbnailUrl !== undefined && oldRow.thumbnailUrl !== data.thumbnailUrl) {
      changes.thumbnailUrl = {
        from: Boolean(oldRow.thumbnailUrl),
        to: Boolean(data.thumbnailUrl),
      };
    }
    if (data.launchDate !== undefined && oldRow.launchDate !== data.launchDate) {
      changes.launchDate = { from: oldRow.launchDate, to: data.launchDate };
    }

    await logAudit({
      action: AUDIT_ACTIONS.CREATIVE_UPDATE,
      entityType: "creative",
      entityId: data.id,
      entityLabel: newName,
      actorUserId: user.id,
      meta: {
        changes,
        ...(data.tags !== undefined ? { tagsCount: data.tags.length } : {}),
        inline: true,
      },
    });

    return { ok: true, name: newName };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Hard-delete a creative and everything attached to it. `performance_records`
 * is FK'd to exactly one creative with NO `ON DELETE CASCADE`, so those rows
 * are removed explicitly first (inside the transaction); `creative_tags`
 * cascades. The audit row survives (it stores a label, not an FK), so the
 * deletion stays visible in the activity feed.
 *
 * This is a sanctioned hard-delete exit path for `performance_records` (added
 * at the user's request), alongside batch-rollback and the cleanup tool. The
 * records belong solely to this creative, so removing it cannot affect any
 * other creative's data. Editor-or-admin only.
 */
export async function deleteCreative(
  creativeId: string,
): Promise<{ ok: boolean; error?: string; recordsDeleted?: number }> {
  try {
    const user = await requireEditor();
    if (!z.string().uuid().safeParse(creativeId).success) {
      return { ok: false, error: "Invalid creative id." };
    }

    const [target] = await db
      .select({ id: creatives.id, name: creatives.name })
      .from(creatives)
      .where(eq(creatives.id, creativeId))
      .limit(1);
    if (!target) return { ok: false, error: "Creative not found." };

    const recordsDeleted = await db.transaction(async (tx) => {
      const countRows = await tx
        .select({ value: count() })
        .from(performanceRecords)
        .where(eq(performanceRecords.creativeId, creativeId));
      const n = countRows[0]?.value ?? 0;
      await tx
        .delete(performanceRecords)
        .where(eq(performanceRecords.creativeId, creativeId));
      // creative_tags cascade on this delete.
      await tx.delete(creatives).where(eq(creatives.id, creativeId));
      return n;
    });

    try {
      revalidatePath("/creatives");
      revalidatePath(`/creatives/${encodeURIComponent(target.name)}`);
    } catch (err) {
      console.warn("revalidatePath after delete failed:", err);
    }

    await logAudit({
      action: AUDIT_ACTIONS.CREATIVE_DELETE,
      entityType: "creative",
      entityId: target.id,
      entityLabel: target.name,
      actorUserId: user.id,
      meta: { recordsDeleted },
    });

    return { ok: true, recordsDeleted };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
