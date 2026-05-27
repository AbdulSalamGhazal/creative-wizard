"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
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
    await requireEditor();
    if (notes.length > 5000) {
      return { ok: false, error: "Notes too long (5000 char max)." };
    }
    await db
      .update(creatives)
      .set({ notes: notes || null, updatedAt: new Date() })
      .where(eq(creatives.id, creativeId));
    try {
      revalidatePath("/creatives");
    } catch (err) {
      console.warn("revalidatePath after notes update failed:", err);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
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
    await requireEditor();
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
      .select({ name: creatives.name })
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

    return { ok: true, name: data.name };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
