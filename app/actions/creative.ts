"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/auth";
import {
  creatives,
  creativeStatusEnum,
  creativeTags,
  creativeTypeEnum,
} from "@/db/schema";
import { creativeCreateSchema } from "@/validators/creative";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

const creativeUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  productId: z.string().uuid(),
  type: z.enum(creativeTypeEnum),
  status: z.enum(creativeStatusEnum),
  thumbnailUrl: z.string().url().optional().nullable(),
  launchDate: z
    .string()
    .date()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  notes: z.string().max(5000).optional().nullable(),
  tags: z.array(z.string().min(1).max(64)).default([]),
});

export type CreativeUpdateInput = z.infer<typeof creativeUpdateSchema>;

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
 * Full creative edit. Supports renaming (with uniqueness check), changing
 * product / type / status / launchDate / notes, and replacing the tag set.
 * Tag replacement is destructive — we wipe + reinsert in one transaction so
 * the new tag set is exactly what the form submitted.
 */
export async function updateCreative(
  input: unknown,
): Promise<CreativeMutationResult> {
  try {
    const user = await requireEditor();
    const parsed = creativeUpdateSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString() ?? "_";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { ok: false, error: "Invalid input", fieldErrors };
    }
    const data = parsed.data;

    // Name uniqueness — only check when the name changed (or someone else owns it).
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

    const [oldRow] = await db
      .select({
        name: creatives.name,
        status: creatives.status,
        productId: creatives.productId,
        type: creatives.type,
      })
      .from(creatives)
      .where(eq(creatives.id, data.id))
      .limit(1);
    if (!oldRow) return { ok: false, error: "Creative not found." };

    await db.transaction(async (tx) => {
      await tx
        .update(creatives)
        .set({
          name: data.name,
          productId: data.productId,
          type: data.type,
          status: data.status,
          thumbnailUrl: data.thumbnailUrl ?? null,
          launchDate: data.launchDate,
          notes: data.notes || null,
          updatedAt: new Date(),
        })
        .where(eq(creatives.id, data.id));

      // Replace tag set.
      await tx.delete(creativeTags).where(eq(creativeTags.creativeId, data.id));
      if (data.tags.length > 0) {
        await tx
          .insert(creativeTags)
          .values(data.tags.map((tag) => ({ creativeId: data.id, tag })))
          .onConflictDoNothing();
      }
    });

    try {
      revalidatePath("/creatives");
      revalidatePath(`/creatives/${encodeURIComponent(oldRow.name)}`);
      revalidatePath(`/creatives/${encodeURIComponent(data.name)}`);
    } catch (err) {
      console.warn("revalidatePath after update failed:", err);
    }

    // Capture only the fields that actually changed so the audit feed reads
    // tightly. `tags` is reported as a count delta — the new set is the
    // ground truth and lives on the creative.
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (oldRow.name !== data.name) changes.name = { from: oldRow.name, to: data.name };
    if (oldRow.status !== data.status) changes.status = { from: oldRow.status, to: data.status };
    if (oldRow.type !== data.type) changes.type = { from: oldRow.type, to: data.type };
    if (oldRow.productId !== data.productId) {
      changes.productId = { from: oldRow.productId, to: data.productId };
    }

    await logAudit({
      action: AUDIT_ACTIONS.CREATIVE_UPDATE,
      entityType: "creative",
      entityId: data.id,
      entityLabel: data.name,
      actorUserId: user.id,
      meta: { changes, tagsCount: data.tags.length },
    });

    return { ok: true, name: data.name };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
