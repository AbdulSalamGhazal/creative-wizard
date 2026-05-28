"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { summaryViews } from "@/db/schema";
import { getSummaryView } from "@/db/queries/summary-views";
import { createSummaryViewSchema } from "@/validators/summary-view";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

export interface ViewMutationResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/**
 * Save the current page configuration as a named view. Any signed-in user
 * can save; the view is team-visible. Name is unique per (owner, page) —
 * a collision returns a clean message instead of a DB error.
 */
export async function createSummaryView(
  input: unknown,
): Promise<ViewMutationResult> {
  try {
    const user = await requireAuth();
    const parsed = createSummaryViewSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { name, query, page } = parsed.data;

    try {
      const [inserted] = await db
        .insert(summaryViews)
        .values({ name, query, page, ownerUserId: user.id })
        .returning({ id: summaryViews.id });

      try {
        revalidatePath("/summary");
      } catch (err) {
        console.warn("revalidatePath after view create failed:", err);
      }

      if (inserted) {
        await logAudit({
          action: AUDIT_ACTIONS.VIEW_CREATE,
          entityType: "view",
          entityId: inserted.id,
          entityLabel: name,
          actorUserId: user.id,
          meta: { page },
        });
      }
      return { ok: true, id: inserted?.id };
    } catch (err) {
      // Unique (owner, page, name) violation → friendly message.
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("summary_views_owner_name_idx") || msg.includes("duplicate")) {
        return {
          ok: false,
          error: "You already have a view with that name.",
        };
      }
      throw err;
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/** Delete a saved view. Owner or admin only. */
export async function deleteSummaryView(
  id: string,
): Promise<ViewMutationResult> {
  try {
    const user = await requireAuth();
    if (!z_uuid(id)) return { ok: false, error: "Invalid id." };

    const view = await getSummaryView(id);
    if (!view) return { ok: false, error: "View not found." };

    if (view.ownerUserId !== user.id && user.role !== "admin") {
      return { ok: false, error: "Only the owner or an admin can delete this view." };
    }

    await db.delete(summaryViews).where(eq(summaryViews.id, id));

    try {
      revalidatePath("/summary");
    } catch (err) {
      console.warn("revalidatePath after view delete failed:", err);
    }

    await logAudit({
      action: AUDIT_ACTIONS.VIEW_DELETE,
      entityType: "view",
      entityId: id,
      entityLabel: view.name,
      actorUserId: user.id,
      meta: { page: view.page },
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
 * Toggle a view as the team default for its page. Setting one clears any
 * existing default (one default per page, also enforced by a partial unique
 * index). Calling on the current default clears it (no default).
 *
 * Any signed-in user can change the team default; it's audit-logged.
 */
export async function setDefaultView(id: string): Promise<ViewMutationResult> {
  try {
    const user = await requireAuth();
    if (!z_uuid(id)) return { ok: false, error: "Invalid id." };

    const view = await getSummaryView(id);
    if (!view) return { ok: false, error: "View not found." };

    const makeDefault = !view.isDefault;

    await db.transaction(async (tx) => {
      // Clear the current default for this page first to satisfy the
      // one-default-per-page partial unique index.
      await tx
        .update(summaryViews)
        .set({ isDefault: false })
        .where(
          and(
            eq(summaryViews.page, view.page),
            eq(summaryViews.isDefault, true),
          ),
        );
      if (makeDefault) {
        await tx
          .update(summaryViews)
          .set({ isDefault: true })
          .where(eq(summaryViews.id, id));
      }
    });

    try {
      revalidatePath("/summary");
    } catch (err) {
      console.warn("revalidatePath after set-default failed:", err);
    }

    await logAudit({
      action: AUDIT_ACTIONS.VIEW_SET_DEFAULT,
      entityType: "view",
      entityId: id,
      entityLabel: view.name,
      actorUserId: user.id,
      meta: { page: view.page, default: makeDefault },
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/** Tiny UUID check without pulling zod into this hot path twice. */
function z_uuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
