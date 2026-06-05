"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { creatives, creativeTags, tags } from "@/db/schema";
import { getTag } from "@/db/queries/tags";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getActiveAccountId } from "@/lib/tenant";

export interface TagMutationResult {
  ok: boolean;
  error?: string;
}

// Tag names mirror the creative_tags column: 1–64 chars, trimmed.
const nameSchema = z.string().trim().min(1, "Name is required").max(64);

function revalidate() {
  try {
    revalidatePath("/admin/catalog");
    revalidatePath("/creatives");
  } catch (err) {
    console.warn("revalidatePath after tag mutation failed:", err);
  }
}

/** Add a tag to the managed vocabulary. Admin only. */
export async function createTag(input: unknown): Promise<TagMutationResult> {
  try {
    const user = await requireAdmin();
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
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.accountId, acct), eq(tags.name, name)))
      .limit(1);
    if (existing) return { ok: false, error: "That tag already exists." };

    const [inserted] = await db
      .insert(tags)
      .values({ accountId: acct, name, createdByUserId: user.id })
      .returning({ id: tags.id });

    revalidate();
    if (inserted) {
      await logAudit({
        action: AUDIT_ACTIONS.TAG_CREATE,
        entityType: "tag",
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
 * Rename a vocabulary tag. The new name cascades to every creative_tags
 * assignment so existing tagged creatives follow the rename.
 */
export async function renameTag(
  id: string,
  newName: string,
): Promise<TagMutationResult> {
  try {
    const user = await requireAdmin();
    const parsed = nameSchema.safeParse(newName);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name" };
    }
    const next = parsed.data;
    const acct = await getActiveAccountId();

    const tag = await getTag(id);
    if (!tag) return { ok: false, error: "Tag not found." };
    if (tag.name === next) return { ok: true };

    const [clash] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.accountId, acct), eq(tags.name, next)))
      .limit(1);
    if (clash) return { ok: false, error: "Another tag already uses that name." };

    // Subquery of this account's creative ids — scopes the cascade so a tag
    // string shared with another brand can't be renamed across tenants.
    const acctCreatives = db
      .select({ id: creatives.id })
      .from(creatives)
      .where(eq(creatives.accountId, acct));

    await db.transaction(async (tx) => {
      await tx.update(tags).set({ name: next }).where(eq(tags.id, id));
      // Cascade to assignments — but ONLY for this account's creatives.
      await tx
        .update(creativeTags)
        .set({ tag: next })
        .where(
          and(
            eq(creativeTags.tag, tag.name),
            inArray(creativeTags.creativeId, acctCreatives),
          ),
        );
    });

    revalidate();
    await logAudit({
      action: AUDIT_ACTIONS.TAG_RENAME,
      entityType: "tag",
      entityId: id,
      entityLabel: next,
      actorUserId: user.id,
      meta: { from: tag.name, to: next },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Delete a vocabulary tag and remove it from every creative that carries it.
 * Admin only.
 */
export async function deleteTag(id: string): Promise<TagMutationResult> {
  try {
    const user = await requireAdmin();
    const acct = await getActiveAccountId();
    const tag = await getTag(id);
    if (!tag) return { ok: false, error: "Tag not found." };

    // Scope the assignment removal to this account's creatives so a shared tag
    // string doesn't get stripped from another brand's creatives.
    const acctCreatives = db
      .select({ id: creatives.id })
      .from(creatives)
      .where(eq(creatives.accountId, acct));

    const removed = await db.transaction(async (tx) => {
      const r = await tx
        .delete(creativeTags)
        .where(
          and(
            eq(creativeTags.tag, tag.name),
            inArray(creativeTags.creativeId, acctCreatives),
          ),
        )
        .returning({ creativeId: creativeTags.creativeId });
      await tx.delete(tags).where(eq(tags.id, id));
      return r.length;
    });

    revalidate();
    await logAudit({
      action: AUDIT_ACTIONS.TAG_DELETE,
      entityType: "tag",
      entityId: id,
      entityLabel: tag.name,
      actorUserId: user.id,
      meta: { removedFromCreatives: removed },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
