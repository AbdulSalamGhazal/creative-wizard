import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/db/schema";
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
