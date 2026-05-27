"use server";

import { revalidatePath } from "next/cache";
import { eq, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { platformFieldMappings, platformEnum } from "@/db/schema";

const FIELDS = [
  "creative_name",
  "date",
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "conversion_value",
  "video_views_3s",
  "video_views_15s",
] as const;

const inputSchema = z.object({
  platform: z.enum(platformEnum),
  internalField: z.enum(FIELDS),
  headerName: z.string().min(1).max(255),
});

export interface MutationResult {
  ok: boolean;
  error?: string;
}

export async function addHeaderMapping(input: unknown): Promise<MutationResult> {
  try {
    const user = await requireAdmin();
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { platform, internalField, headerName } = parsed.data;
    const trimmed = headerName.trim();
    if (trimmed.length === 0) return { ok: false, error: "Header name is empty." };

    // Append at the end of the priority list for the (platform, field).
    const [{ max: maxPriority } = { max: null }] = await db
      .select({ max: max(platformFieldMappings.priority) })
      .from(platformFieldMappings)
      .where(eq(platformFieldMappings.platform, platform));

    await db
      .insert(platformFieldMappings)
      .values({
        platform,
        internalField,
        headerName: trimmed,
        priority: (maxPriority ?? -1) + 1,
        createdByUserId: user.id,
      })
      .onConflictDoNothing({
        target: [
          platformFieldMappings.platform,
          platformFieldMappings.internalField,
          platformFieldMappings.headerName,
        ],
      });

    try {
      revalidatePath("/admin/platforms");
    } catch (err) {
      console.warn("revalidatePath failed:", err);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function removeHeaderMapping(id: string): Promise<MutationResult> {
  try {
    await requireAdmin();
    if (!z.string().uuid().safeParse(id).success) {
      return { ok: false, error: "Invalid id." };
    }
    await db
      .delete(platformFieldMappings)
      .where(eq(platformFieldMappings.id, id));
    try {
      revalidatePath("/admin/platforms");
    } catch (err) {
      console.warn("revalidatePath failed:", err);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

