"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { products } from "@/db/schema";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getActiveAccountId } from "@/lib/tenant";

export interface ProductMutationResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const nameSchema = z.string().min(1).max(255);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255) || "product";
}

export async function createProduct(input: unknown): Promise<ProductMutationResult> {
  try {
    const user = await requirePermission("catalog.products");
    const parsed = nameSchema.safeParse(
      typeof input === "object" && input !== null
        ? (input as { name?: unknown }).name
        : undefined,
    );
    if (!parsed.success) {
      return {
        ok: false,
        error: "Invalid name",
        fieldErrors: { name: parsed.error.issues[0]?.message ?? "Invalid" },
      };
    }
    const name = parsed.data.trim();
    let slug = slugify(name);
    const acct = await getActiveAccountId();

    // Ensure slug uniqueness within this account (append -2, -3 …).
    const baseSlug = slug;
    for (let i = 2; ; i++) {
      const [existing] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.accountId, acct), eq(products.slug, slug)))
        .limit(1);
      if (!existing) break;
      slug = `${baseSlug}-${i}`;
      if (i > 50) {
        return { ok: false, error: "Could not derive a unique slug." };
      }
    }

    // Name uniqueness pre-check (scoped to this account).
    const [nameExists] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.accountId, acct), eq(products.name, name)))
      .limit(1);
    if (nameExists) {
      return {
        ok: false,
        error: "A product with that name already exists.",
        fieldErrors: { name: "Already in use" },
      };
    }

    const [inserted] = await db
      .insert(products)
      .values({
        accountId: acct,
        name,
        slug,
        createdByUserId: user.id,
      })
      .returning({ id: products.id });

    try {
      revalidatePath("/admin/products");
      revalidatePath("/creatives");
    } catch (err) {
      console.warn("revalidatePath after product create failed:", err);
    }
    if (inserted) {
      await logAudit({
        action: AUDIT_ACTIONS.PRODUCT_CREATE,
        entityType: "product",
        entityId: inserted.id,
        entityLabel: name,
        actorUserId: user.id,
        meta: { slug },
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function archiveProduct(productId: string): Promise<ProductMutationResult> {
  try {
    const me = await requirePermission("catalog.products");
    const acct = await getActiveAccountId();
    const [existing] = await db
      .select({ id: products.id, status: products.status, name: products.name })
      .from(products)
      .where(and(eq(products.accountId, acct), eq(products.id, productId)))
      .limit(1);
    if (!existing) return { ok: false, error: "Product not found." };
    if (existing.status === "archived") return { ok: true };

    await db
      .update(products)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(products.accountId, acct), eq(products.id, productId)));

    try {
      revalidatePath("/admin/products");
      revalidatePath("/creatives");
    } catch (err) {
      console.warn("revalidatePath after archive failed:", err);
    }
    await logAudit({
      action: AUDIT_ACTIONS.PRODUCT_ARCHIVE,
      entityType: "product",
      entityId: productId,
      entityLabel: existing.name,
      actorUserId: me.id,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function restoreProduct(productId: string): Promise<ProductMutationResult> {
  try {
    const me = await requirePermission("catalog.products");
    const acct = await getActiveAccountId();
    const [existing] = await db
      .select({ name: products.name })
      .from(products)
      .where(and(eq(products.accountId, acct), eq(products.id, productId)))
      .limit(1);
    await db
      .update(products)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(products.accountId, acct), eq(products.id, productId)));
    try {
      revalidatePath("/admin/products");
      revalidatePath("/creatives");
    } catch (err) {
      console.warn("revalidatePath after restore failed:", err);
    }
    await logAudit({
      action: AUDIT_ACTIONS.PRODUCT_RESTORE,
      entityType: "product",
      entityId: productId,
      entityLabel: existing?.name ?? null,
      actorUserId: me.id,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
