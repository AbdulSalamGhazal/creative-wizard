"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/auth";
import { creatives, creativeTags } from "@/db/schema";
import { creativeCreateSchema } from "@/validators/creative";

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
