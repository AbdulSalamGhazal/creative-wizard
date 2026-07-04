import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { creatives, products } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";

/** Minimal product list for filter dropdowns. Full CRUD is a separate slice. */
export async function listProducts(): Promise<
  Array<{ id: string; name: string }>
> {
  const acct = await getActiveAccountId();
  return db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(and(eq(products.accountId, acct), eq(products.status, "active")))
    .orderBy(asc(products.name));
}

/**
 * Creative count per product for the Catalog admin table. Lives in the query
 * layer (not app/actions) on purpose: it used to be an export of a
 * `"use server"` module, which made it a publicly invokable endpoint with no
 * auth check — server actions are for mutations, reads belong here where only
 * server components (already behind auth) can reach them.
 */
export async function countCreativesPerProduct(): Promise<Map<string, number>> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({ productId: creatives.productId, c: count() })
    .from(creatives)
    .where(eq(creatives.accountId, acct))
    .groupBy(creatives.productId);
  return new Map(rows.map((r) => [r.productId, Number(r.c)]));
}
