"use server";

import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { platformFieldMappings } from "@/db/schema";
import { isFieldUnavailableOn } from "@/csv/platforms/types";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getActiveAccountId } from "@/lib/tenant";
import { actionError } from "@/lib/action-error";
import { platformMappingSchema } from "@/validators/platform-mapping";
import { uuidSchema } from "@/validators/shared";


export interface MutationResult {
  ok: boolean;
  error?: string;
}

export async function addHeaderMapping(input: unknown): Promise<MutationResult> {
  try {
    const user = await requirePermission("config.mappings");
    const parsed = platformMappingSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { platform, internalField, headerName } = parsed.data;
    // The UI doesn't offer these, but the server is the boundary: a header
    // mapped for a metric the platform can't report would be silently ignored
    // (the pipeline stores NULL for it by declaration), so refuse it outright.
    if (isFieldUnavailableOn(internalField, platform)) {
      return {
        ok: false,
        error: `${platform} exports don't carry that metric — it is stored as NULL, so a header mapping would be ignored.`,
      };
    }
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
      revalidatePath("/uploads"); // CSV mapping lives on /uploads?tab=mapping
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
    return { ok: false, error: actionError(err, "platform_mapping") };
  }
}

export async function removeHeaderMapping(id: string): Promise<MutationResult> {
  try {
    const me = await requirePermission("config.mappings");
    if (!uuidSchema.safeParse(id).success) {
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
    return { ok: false, error: actionError(err, "platform_mapping") };
  }
}

