"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/auth";
import {
  creatives,
  creativePlatformOverrides,
  creativeTags,
  creativeTypeEnum,
  performanceRecords,
  products,
} from "@/db/schema";
import {
  creativeCreateSchema,
  creativeTerminationSchema,
} from "@/validators/creative";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getActiveAccountId } from "@/lib/tenant";

export interface CreativeMutationResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  name?: string;
}

/** Does this product exist AND belong to the given account? */
async function productInAccount(
  productId: string,
  acct: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.accountId, acct), eq(products.id, productId)))
    .limit(1);
  return Boolean(row);
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
    const acct = await getActiveAccountId();

    // Name uniqueness pre-check (DB will enforce, but a clean message helps).
    // Names are unique per account, so scope the check.
    const existing = await db
      .select({ id: creatives.id })
      .from(creatives)
      .where(and(eq(creatives.accountId, acct), eq(creatives.name, data.name)))
      .limit(1);
    if (existing.length > 0) {
      return {
        ok: false,
        error: "A creative with that name already exists.",
        fieldErrors: { name: "Already in use" },
      };
    }

    // The product must belong to the active brand — the FK only enforces that
    // the product exists globally, so without this a forged payload (or a stale
    // id) could bind this creative to another brand's product.
    if (!(await productInAccount(data.productId, acct))) {
      return {
        ok: false,
        error: "Unknown product.",
        fieldErrors: { productId: "Invalid product" },
      };
    }

    const [inserted] = await db
      .insert(creatives)
      .values({
        // `status` is intentionally omitted — the DB column keeps its
        // NOT NULL DEFAULT 'draft', which is now ignored. Status is derived
        // dynamically (see lib/creative-status.ts); new creatives read as "New".
        accountId: acct,
        name: data.name,
        productId: data.productId,
        type: data.type,
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
    const acct = await getActiveAccountId();
    const [updated] = await db
      .update(creatives)
      .set({ notes: notes || null, updatedAt: new Date() })
      .where(and(eq(creatives.accountId, acct), eq(creatives.id, creativeId)))
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
 * Set (or clear) the manual per-platform TERMINATION on a creative — the only
 * manual status lever now that the rest of the status is derived. A row in
 * `creative_platform_overrides` marks the creative as Terminated on that
 * platform; deleting it reactivates (the platform falls back to its derived
 * active/pause status). Editor-or-admin only; account-scoped both ways.
 */
export async function setCreativeTermination(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requireEditor();
    const parsed = creativeTerminationSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { creativeId, platform, terminated } = parsed.data;
    const acct = await getActiveAccountId();

    // The creative must belong to the active brand (the override FK only
    // enforces global existence — re-validate against the account before write).
    const [target] = await db
      .select({ id: creatives.id, name: creatives.name })
      .from(creatives)
      .where(and(eq(creatives.accountId, acct), eq(creatives.id, creativeId)))
      .limit(1);
    if (!target) return { ok: false, error: "Creative not found." };

    if (terminated) {
      await db
        .insert(creativePlatformOverrides)
        .values({
          accountId: acct,
          creativeId,
          platform,
          terminatedByUserId: user.id,
        })
        .onConflictDoNothing();
    } else {
      await db
        .delete(creativePlatformOverrides)
        .where(
          and(
            eq(creativePlatformOverrides.accountId, acct),
            eq(creativePlatformOverrides.creativeId, creativeId),
            eq(creativePlatformOverrides.platform, platform),
          ),
        );
    }

    try {
      revalidatePath("/creatives");
      revalidatePath(`/creatives/${encodeURIComponent(target.name)}`);
    } catch (err) {
      console.warn("revalidatePath after termination change failed:", err);
    }

    await logAudit({
      action: AUDIT_ACTIONS.CREATIVE_UPDATE,
      entityType: "creative",
      entityId: target.id,
      entityLabel: target.name,
      actorUserId: user.id,
      meta: { termination: { platform, terminated } },
    });

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Inline edit from the creative detail page — the single save path for every
 * editable field (name / product / type / thumbnail / launch date / tags).
 * Status is NOT here — it's derived dynamically, with per-platform termination
 * as the only manual lever (see setCreativeTermination). Every field is
 * optional; only the fields actually present in the payload are written. Tags, when provided, replace the whole set (wipe +
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
    const acct = await getActiveAccountId();

    const [oldRow] = await db
      .select({
        name: creatives.name,
        productId: creatives.productId,
        type: creatives.type,
        thumbnailUrl: creatives.thumbnailUrl,
        launchDate: creatives.launchDate,
      })
      .from(creatives)
      .where(and(eq(creatives.accountId, acct), eq(creatives.id, data.id)))
      .limit(1);
    if (!oldRow) return { ok: false, error: "Creative not found." };

    // Name uniqueness — only when actually renaming (scoped to this account).
    if (data.name !== undefined && data.name !== oldRow.name) {
      const [collision] = await db
        .select({ id: creatives.id })
        .from(creatives)
        .where(
          and(
            eq(creatives.accountId, acct),
            eq(creatives.name, data.name),
            ne(creatives.id, data.id),
          ),
        )
        .limit(1);
      if (collision) {
        return {
          ok: false,
          error: "A creative with that name already exists.",
          fieldErrors: { name: "Already in use" },
        };
      }
    }

    // Re-parenting to a product? It must belong to the active brand (the FK is
    // global, so this is the only thing stopping a cross-tenant re-parent).
    if (
      data.productId !== undefined &&
      data.productId !== oldRow.productId &&
      !(await productInAccount(data.productId, acct))
    ) {
      return {
        ok: false,
        error: "Unknown product.",
        fieldErrors: { productId: "Invalid product" },
      };
    }

    // Build a set clause from only the provided scalar fields.
    const set: Partial<typeof creatives.$inferInsert> = { updatedAt: new Date() };
    if (data.name !== undefined) set.name = data.name;
    if (data.productId !== undefined) set.productId = data.productId;
    if (data.type !== undefined) set.type = data.type;
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
    const acct = await getActiveAccountId();

    const [target] = await db
      .select({ id: creatives.id, name: creatives.name })
      .from(creatives)
      .where(and(eq(creatives.accountId, acct), eq(creatives.id, creativeId)))
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
