"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { landingPages, performanceRecords, products } from "@/db/schema";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getActiveAccountId } from "@/lib/tenant";
import { actionError } from "@/lib/action-error";
import {
  landingPageInputSchema,
  landingPageUpdateSchema,
} from "@/validators/landing-page";

/** `db` or a transaction — the reads below run inside the row lock. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Lock one of this brand's landing pages FOR UPDATE until the transaction
 * ends. An upload commit inserting records that point here takes FOR KEY
 * SHARE on the same row (the FK check, and the commit's own re-check), which
 * conflicts — so "is it in use?" and the write that depends on the answer
 * can't be split by a concurrent import.
 */
async function lockLandingPage(tx: Executor, acct: string, id: string) {
  const [row] = await tx
    .select({
      name: landingPages.name,
      code: landingPages.code,
      url: landingPages.url,
      description: landingPages.description,
      productId: landingPages.productId,
    })
    .from(landingPages)
    .where(and(eq(landingPages.accountId, acct), eq(landingPages.id, id)))
    .for("update");
  return row ?? null;
}

/**
 * The product a page is being given must be one of the active brand's — a
 * caller-supplied FK is re-validated before every write (tenancy rule).
 * Returns the product's name for the audit row, or null when it isn't ours.
 */
async function ownProduct(ex: Executor, acct: string, productId: string) {
  const [row] = await ex
    .select({ name: products.name })
    .from(products)
    .where(and(eq(products.accountId, acct), eq(products.id, productId)));
  return row?.name ?? null;
}

const NOT_OUR_PRODUCT: LandingPageMutationResult = {
  ok: false,
  error: "Pick one of this brand's products.",
  fieldErrors: { productId: "Not found" },
};

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
async function codeTaken(
  ex: Executor,
  acct: string,
  code: string,
  exceptId?: string,
) {
  const rows = await ex
    .select({ id: landingPages.id, code: landingPages.code })
    .from(landingPages)
    .where(eq(landingPages.accountId, acct));
  const wanted = code.toLowerCase();
  return rows.find((r) => r.id !== exceptId && r.code.toLowerCase() === wanted) ?? null;
}

async function recordsUsing(ex: Executor, acct: string, id: string): Promise<number> {
  const [row] = await ex
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

    const clash = await codeTaken(db, acct, data.code);
    if (clash) {
      return {
        ok: false,
        error: `@${clash.code} is already a landing page.`,
        fieldErrors: { code: "Already in use" },
      };
    }
    const productName = await ownProduct(db, acct, data.productId);
    if (productName === null) return NOT_OUR_PRODUCT;

    const [inserted] = await db
      .insert(landingPages)
      .values({
        accountId: acct,
        name: data.name,
        code: data.code,
        url: data.url,
        description: data.description,
        productId: data.productId,
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
        meta: { code: data.code, product: productName },
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

    // Check-then-write under the row lock (see lockLandingPage): a refusal
    // returns from inside the transaction, which simply commits nothing.
    const outcome = await db.transaction(
      async (tx): Promise<LandingPageMutationResult | { changed: string[] }> => {
        const existing = await lockLandingPage(tx, acct, data.id);
        if (!existing) return { ok: false, error: "Landing page not found." };

        if (data.code !== existing.code) {
          // The code is what ad names carry on the platforms. Once records use
          // it, changing it would orphan every live ad's suffix — locked.
          const used = await recordsUsing(tx, acct, data.id);
          if (used > 0) {
            return {
              ok: false,
              error: `@${existing.code} is used by ${used} record${used === 1 ? "" : "s"}, so its code can't change.`,
              fieldErrors: { code: "Locked" },
            };
          }
          const clash = await codeTaken(tx, acct, data.code, data.id);
          if (clash) {
            return {
              ok: false,
              error: `@${clash.code} is already a landing page.`,
              fieldErrors: { code: "Already in use" },
            };
          }
        }

        if (data.productId !== existing.productId) {
          // A page that has records under one product can't move to another:
          // those rows were accepted because the creative matched (E024), and
          // moving the page would put them in the wrong product's comparison.
          // A page that still has NO product may be given one — that is the
          // post-backfill "Needs a product" path.
          if (existing.productId !== null) {
            const used = await recordsUsing(tx, acct, data.id);
            if (used > 0) {
              return {
                ok: false,
                error: `@${existing.code} is used by ${used} record${used === 1 ? "" : "s"}, so its product can't change.`,
                fieldErrors: { productId: "Locked" },
              };
            }
          }
          if ((await ownProduct(tx, acct, data.productId)) === null) return NOT_OUR_PRODUCT;
        }

        const changed = (["name", "code", "url", "description", "productId"] as const).filter(
          (k) => (data[k] ?? null) !== (existing[k] ?? null),
        );
        if (changed.length === 0) return { changed };

        await tx
          .update(landingPages)
          .set({
            name: data.name,
            code: data.code,
            url: data.url,
            description: data.description,
            productId: data.productId,
            updatedAt: new Date(),
          })
          .where(and(eq(landingPages.accountId, acct), eq(landingPages.id, data.id)));
        return { changed };
      },
    );
    if (!("changed" in outcome)) return outcome;
    const { changed } = outcome;
    if (changed.length === 0) return { ok: true };

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
    // Under the row lock, like update. The FK (no cascade) would refuse a
    // delete that loses the race anyway; the lock turns that into the
    // friendly "in use" answer instead of a constraint error.
    const outcome = await db.transaction(
      async (tx): Promise<LandingPageMutationResult | { name: string; code: string }> => {
        const existing = await lockLandingPage(tx, acct, id);
        if (!existing) return { ok: false, error: "Landing page not found." };

        const used = await recordsUsing(tx, acct, id);
        if (used > 0) {
          return {
            ok: false,
            error: `@${existing.code} is used by ${used} record${used === 1 ? "" : "s"}, so it can't be deleted.`,
          };
        }

        await tx
          .delete(landingPages)
          .where(and(eq(landingPages.accountId, acct), eq(landingPages.id, id)));
        return { name: existing.name, code: existing.code };
      },
    );
    if ("ok" in outcome) return outcome;
    const existing = outcome;

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
