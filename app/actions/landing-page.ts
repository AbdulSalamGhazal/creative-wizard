"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { landingPages, performanceRecords } from "@/db/schema";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getActiveAccountId } from "@/lib/tenant";
import { actionError } from "@/lib/action-error";
import {
  landingPageInputSchema,
  landingPageUpdateSchema,
} from "@/validators/landing-page";

export interface LandingPageMutationResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

function invalid(error: z.ZodError): LandingPageMutationResult {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0]?.toString() ?? "_";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return {
    ok: false,
    error: error.issues[0]?.message ?? "Check the highlighted fields.",
    fieldErrors,
  };
}

/**
 * Is `code` already registered in this brand under ANY casing (other than
 * the row being edited)? Uploads match codes case-sensitively, so `LP2` next
 * to `lp2` would be two pages a person can't tell apart in an ad name. The
 * brand's list is small; comparing in JS avoids LIKE's `_` wildcard, which
 * codes may contain.
 */
async function codeTaken(acct: string, code: string, exceptId?: string) {
  const rows = await db
    .select({ id: landingPages.id, code: landingPages.code })
    .from(landingPages)
    .where(eq(landingPages.accountId, acct));
  const wanted = code.toLowerCase();
  return rows.find((r) => r.id !== exceptId && r.code.toLowerCase() === wanted) ?? null;
}

async function recordsUsing(acct: string, id: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.landingPageId, id),
      ),
    );
  return Number(row?.n ?? 0);
}

function refresh() {
  try {
    revalidatePath("/library");
  } catch (err) {
    console.warn("revalidatePath after landing page change failed:", err);
  }
}

export async function createLandingPage(
  input: unknown,
): Promise<LandingPageMutationResult> {
  try {
    const user = await requirePermission("catalog.landing_pages");
    const parsed = landingPageInputSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const data = parsed.data;
    const acct = await getActiveAccountId();

    const clash = await codeTaken(acct, data.code);
    if (clash) {
      return {
        ok: false,
        error: `@${clash.code} is already a landing page.`,
        fieldErrors: { code: "Already in use" },
      };
    }

    const [inserted] = await db
      .insert(landingPages)
      .values({
        accountId: acct,
        name: data.name,
        code: data.code,
        url: data.url,
        description: data.description,
        createdByUserId: user.id,
      })
      .returning({ id: landingPages.id });

    refresh();
    if (inserted) {
      await logAudit({
        action: AUDIT_ACTIONS.LANDING_PAGE_CREATE,
        entityType: "landing_page",
        entityId: inserted.id,
        entityLabel: data.name,
        actorUserId: user.id,
        meta: { code: data.code },
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "landing page") };
  }
}

export async function updateLandingPage(
  input: unknown,
): Promise<LandingPageMutationResult> {
  try {
    const user = await requirePermission("catalog.landing_pages");
    const parsed = landingPageUpdateSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const data = parsed.data;
    const acct = await getActiveAccountId();

    const [existing] = await db
      .select({
        name: landingPages.name,
        code: landingPages.code,
        url: landingPages.url,
        description: landingPages.description,
      })
      .from(landingPages)
      .where(and(eq(landingPages.accountId, acct), eq(landingPages.id, data.id)))
      .limit(1);
    if (!existing) return { ok: false, error: "Landing page not found." };

    if (data.code !== existing.code) {
      // The code is what ad names carry on the platforms. Once records use it,
      // changing it would orphan every live ad's suffix — locked.
      const used = await recordsUsing(acct, data.id);
      if (used > 0) {
        return {
          ok: false,
          error: `@${existing.code} is used by ${used} record${used === 1 ? "" : "s"}, so its code can't change.`,
          fieldErrors: { code: "Locked" },
        };
      }
      const clash = await codeTaken(acct, data.code, data.id);
      if (clash) {
        return {
          ok: false,
          error: `@${clash.code} is already a landing page.`,
          fieldErrors: { code: "Already in use" },
        };
      }
    }

    const changed = (["name", "code", "url", "description"] as const).filter(
      (k) => (data[k] ?? null) !== (existing[k] ?? null),
    );
    if (changed.length === 0) return { ok: true };

    await db
      .update(landingPages)
      .set({
        name: data.name,
        code: data.code,
        url: data.url,
        description: data.description,
        updatedAt: new Date(),
      })
      .where(and(eq(landingPages.accountId, acct), eq(landingPages.id, data.id)));

    refresh();
    await logAudit({
      action: AUDIT_ACTIONS.LANDING_PAGE_UPDATE,
      entityType: "landing_page",
      entityId: data.id,
      entityLabel: data.name,
      actorUserId: user.id,
      meta: { changed, code: data.code },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "landing page") };
  }
}

export async function deleteLandingPage(
  id: string,
): Promise<LandingPageMutationResult> {
  try {
    const user = await requirePermission("catalog.landing_pages");
    const acct = await getActiveAccountId();
    const [existing] = await db
      .select({ name: landingPages.name, code: landingPages.code })
      .from(landingPages)
      .where(and(eq(landingPages.accountId, acct), eq(landingPages.id, id)))
      .limit(1);
    if (!existing) return { ok: false, error: "Landing page not found." };

    const used = await recordsUsing(acct, id);
    if (used > 0) {
      return {
        ok: false,
        error: `@${existing.code} is used by ${used} record${used === 1 ? "" : "s"}, so it can't be deleted.`,
      };
    }

    await db
      .delete(landingPages)
      .where(and(eq(landingPages.accountId, acct), eq(landingPages.id, id)));

    refresh();
    await logAudit({
      action: AUDIT_ACTIONS.LANDING_PAGE_DELETE,
      entityType: "landing_page",
      entityId: id,
      entityLabel: existing.name,
      actorUserId: user.id,
      meta: { code: existing.code },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "landing page") };
  }
}
