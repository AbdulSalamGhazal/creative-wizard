import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformRatingRules, ratingRules } from "@/db/schema";
import {
  DEFAULT_RATING_RULES,
  type RatingConfig,
  type RatingRules,
} from "@/lib/rating";

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

/**
 * Read the full rating config: the default (singleton) plus every per-platform
 * override. Platforms without an override row simply fall back to the default
 * at resolution time (lib/rating#rulesForScope).
 */
export async function getRatingConfig(): Promise<RatingConfig> {
  const [def, overrides] = await Promise.all([
    getRatingRules(),
    db
      .select({
        platform: platformRatingRules.platform,
        minSpend: platformRatingRules.minSpend,
        goodRoas: platformRatingRules.goodRoas,
        decentRoas: platformRatingRules.decentRoas,
      })
      .from(platformRatingRules),
  ]);

  const byPlatform: Record<string, RatingRules> = {};
  for (const o of overrides) {
    byPlatform[o.platform] = {
      minSpend: Number(o.minSpend),
      goodRoas: Number(o.goodRoas),
      decentRoas: Number(o.decentRoas),
    };
  }
  return { default: def, byPlatform };
}

export { SINGLETON_ID as RATING_RULES_ID };
