"use server";

import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { platformFieldMappings, platformEnum } from "@/db/schema";
import { INTERNAL_FIELDS } from "@/csv/platforms/types";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getActiveAccountId } from "@/lib/tenant";

const inputSchema = z.object({
  platform: z.enum(platformEnum),
  internalField: z.enum(INTERNAL_FIELDS),
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
    const acct = await getActiveAccountId();

    // Append at the end of the priority list for this account's (platform, field).
    const [{ max: maxPriority } = { max: null }] = await db
      .select({ max: max(platformFieldMappings.priority) })
      .from(platformFieldMappings)
      .where(
        and(
          eq(platformFieldMappings.accountId, acct),
          eq(platformFieldMappings.platform, platform),
        ),
      );

    const [inserted] = await db
      .insert(platformFieldMappings)
      .values({
        accountId: acct,
        platform,
        internalField,
        headerName: trimmed,
        priority: (maxPriority ?? -1) + 1,
        createdByUserId: user.id,
      })
      .onConflictDoNothing({
        // Must match the unique index, which is now account-prefixed.
        target: [
          platformFieldMappings.accountId,
          platformFieldMappings.platform,
          platformFieldMappings.internalField,
          platformFieldMappings.headerName,
        ],
      })
      .returning({ id: platformFieldMappings.id });

    try {
      revalidatePath("/admin/platforms");
    } catch (err) {
      console.warn("revalidatePath failed:", err);
    }
    if (inserted) {
      await logAudit({
        action: AUDIT_ACTIONS.MAPPING_ADD,
        entityType: "mapping",
        entityId: inserted.id,
        entityLabel: `${platform} · ${internalField} ← ${trimmed}`,
        actorUserId: user.id,
        meta: { platform, internalField, headerName: trimmed },
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function removeHeaderMapping(id: string): Promise<MutationResult> {
  try {
    const me = await requireAdmin();
    if (!z.string().uuid().safeParse(id).success) {
      return { ok: false, error: "Invalid id." };
    }
    const acct = await getActiveAccountId();
    const [existing] = await db
      .select({
        platform: platformFieldMappings.platform,
        internalField: platformFieldMappings.internalField,
        headerName: platformFieldMappings.headerName,
      })
      .from(platformFieldMappings)
      .where(
        and(
          eq(platformFieldMappings.accountId, acct),
          eq(platformFieldMappings.id, id),
        ),
      )
      .limit(1);
    await db
      .delete(platformFieldMappings)
      .where(
        and(
          eq(platformFieldMappings.accountId, acct),
          eq(platformFieldMappings.id, id),
        ),
      );
    try {
      revalidatePath("/admin/platforms");
    } catch (err) {
      console.warn("revalidatePath failed:", err);
    }
    if (existing) {
      await logAudit({
        action: AUDIT_ACTIONS.MAPPING_REMOVE,
        entityType: "mapping",
        entityId: id,
        entityLabel: `${existing.platform} · ${existing.internalField} ← ${existing.headerName}`,
        actorUserId: me.id,
        meta: existing,
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

