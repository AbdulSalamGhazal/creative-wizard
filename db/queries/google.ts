import { and, eq, sql } from "drizzle-orm";
import { creatives, products } from "@/db/schema";
import type { db as Db } from "@/lib/db";
import {
  GOOGLE_SYSTEM_CREATIVE_NAME,
  GOOGLE_SYSTEM_PRODUCT_NAME,
} from "@/lib/google";

/** Any drizzle executor — the live db or a transaction handle. */
type Executor = typeof Db | Parameters<Parameters<typeof Db.transaction>[0]>[0];

/**
 * Find-or-create the ONE system creative every google row hangs off.
 *
 * Google exports have no creative column, so the adapter stamps every row with
 * `GOOGLE_SYSTEM_CREATIVE_NAME` and the pipeline's ordinary trim-then-exact
 * matching resolves it. That only works if the row EXISTS, so this runs before
 * the names snapshot is taken at validate time and again inside the commit
 * transaction — it is idempotent and account-scoped, so calling it twice (or
 * concurrently, on two uploads) leaves exactly one row.
 *
 * Its product is the account's "Collection" product, matched case-insensitively
 * and CREATED when the brand doesn't have one — every creative needs a
 * `product_id`, and google spend is brand-wide rather than per-product. The
 * lookup is account-scoped rather than trusting a caller-supplied id, per the
 * FK-revalidation house rule.
 */
export async function ensureGoogleCreative(
  tx: Executor,
  accountId: string,
  createdByUserId: string,
): Promise<string> {
  const [existing] = await tx
    .select({ id: creatives.id })
    .from(creatives)
    .where(
      and(
        eq(creatives.accountId, accountId),
        eq(creatives.name, GOOGLE_SYSTEM_CREATIVE_NAME),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const productId = await ensureCollectionProduct(tx, accountId, createdByUserId);

  const [created] = await tx
    .insert(creatives)
    .values({
      accountId,
      name: GOOGLE_SYSTEM_CREATIVE_NAME,
      productId,
      type: "image",
      isSystem: true,
      createdByUserId,
    })
    .onConflictDoNothing()
    .returning({ id: creatives.id });
  if (created) return created.id;

  // Lost a race with a concurrent upload — the other one's row is the answer.
  const [raced] = await tx
    .select({ id: creatives.id })
    .from(creatives)
    .where(
      and(
        eq(creatives.accountId, accountId),
        eq(creatives.name, GOOGLE_SYSTEM_CREATIVE_NAME),
      ),
    )
    .limit(1);
  if (!raced) throw new Error("Could not create the Google Ads system creative.");
  return raced.id;
}

/** The account's "Collection" product (case-insensitive), created if absent. */
async function ensureCollectionProduct(
  tx: Executor,
  accountId: string,
  createdByUserId: string,
): Promise<string> {
  const [match] = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.accountId, accountId),
        sql`lower(${products.name}) = lower(${GOOGLE_SYSTEM_PRODUCT_NAME})`,
      ),
    )
    .limit(1);
  if (match) return match.id;

  const [created] = await tx
    .insert(products)
    .values({
      accountId,
      name: GOOGLE_SYSTEM_PRODUCT_NAME,
      slug: GOOGLE_SYSTEM_PRODUCT_NAME.toLowerCase(),
      createdByUserId,
    })
    .onConflictDoNothing()
    .returning({ id: products.id });
  if (created) return created.id;

  const [raced] = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.accountId, accountId),
        sql`lower(${products.name}) = lower(${GOOGLE_SYSTEM_PRODUCT_NAME})`,
      ),
    )
    .limit(1);
  if (!raced) throw new Error("Could not create the Collection product.");
  return raced.id;
}
