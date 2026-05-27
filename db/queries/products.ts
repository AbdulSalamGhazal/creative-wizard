import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/db/schema";

/** Minimal product list for filter dropdowns. Full CRUD is a separate slice. */
export async function listProducts(): Promise<
  Array<{ id: string; name: string }>
> {
  return db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.status, "active"))
    .orderBy(asc(products.name));
}
