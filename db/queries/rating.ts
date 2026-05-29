import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ratingRules } from "@/db/schema";
import { DEFAULT_RATING_RULES, type RatingRules } from "@/lib/rating";

const SINGLETON_ID = 1;

/**
 * Read the global rating rules. Returns the seeded singleton (id = 1), or the
 * built-in defaults if the row is missing — so /summary never breaks just
 * because the config hasn't been touched. Numeric columns come back as
 * strings from postgres-js, so coerce at the edge.
 */
export async function getRatingRules(): Promise<RatingRules> {
  const [row] = await db
    .select({
      minSpend: ratingRules.minSpend,
      goodRoas: ratingRules.goodRoas,
      decentRoas: ratingRules.decentRoas,
    })
    .from(ratingRules)
    .where(eq(ratingRules.id, SINGLETON_ID))
    .limit(1);

  if (!row) return DEFAULT_RATING_RULES;

  return {
    minSpend: Number(row.minSpend),
    goodRoas: Number(row.goodRoas),
    decentRoas: Number(row.decentRoas),
  };
}

export { SINGLETON_ID as RATING_RULES_ID };
