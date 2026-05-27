"use server";

import { revalidatePath } from "next/cache";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { creatives, products } from "@/db/schema";

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
    const user = await requireAdmin();
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

    // Ensure slug uniqueness (append -2, -3 …).
    const baseSlug = slug;
    for (let i = 2; ; i++) {
      const [existing] = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.slug, slug))
        .limit(1);
      if (!existing) break;
      slug = `${baseSlug}-${i}`;
      if (i > 50) {
        return { ok: false, error: "Could not derive a unique slug." };
      }
    }

    // Name uniqueness pre-check.
    const [nameExists] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.name, name))
      .limit(1);
    if (nameExists) {
      return {
        ok: false,
        error: "A product with that name already exists.",
        fieldErrors: { name: "Already in use" },
      };
    }

    await db.insert(products).values({
      name,
      slug,
      createdByUserId: user.id,
    });

    try {
      revalidatePath("/admin/products");
      revalidatePath("/creatives");
    } catch (err) {
      console.warn("revalidatePath after product create failed:", err);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function archiveProduct(productId: string): Promise<ProductMutationResult> {
  try {
    await requireAdmin();
    const [existing] = await db
      .select({ id: products.id, status: products.status })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!existing) return { ok: false, error: "Product not found." };
    if (existing.status === "archived") return { ok: true };

    await db
      .update(products)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(products.id, productId));

    try {
      revalidatePath("/admin/products");
      revalidatePath("/creatives");
    } catch (err) {
      console.warn("revalidatePath after archive failed:", err);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function restoreProduct(productId: string): Promise<ProductMutationResult> {
  try {
    await requireAdmin();
    await db
      .update(products)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(products.id, productId));
    try {
      revalidatePath("/admin/products");
      revalidatePath("/creatives");
    } catch (err) {
      console.warn("revalidatePath after restore failed:", err);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function countCreativesPerProduct(): Promise<Map<string, number>> {
  const rows = await db
    .select({ productId: creatives.productId, c: count() })
    .from(creatives)
    .groupBy(creatives.productId);
  return new Map(rows.map((r) => [r.productId, Number(r.c)]));
}
