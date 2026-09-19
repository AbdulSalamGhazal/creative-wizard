/**
 * Google Ads vocabulary — the two names the google integration pins in code.
 * Client-safe (no DB imports) so the CSV adapter, the actions and the UI all
 * read the same strings.
 *
 * Google exports have no creative column: every row belongs to the ONE system
 * creative, so the whole platform reconciles under a single library row rather
 * than inventing a fake creative per ad. See the CLAUDE.md google bullet.
 */

/** The name of the system creative every google row is stamped with. */
export const GOOGLE_SYSTEM_CREATIVE_NAME = "Google Ads";

/**
 * The product the system creative hangs off. Every creative needs a
 * `product_id`, and google spend is brand-wide rather than per-product, so it
 * parks on the account's "Collection" product (matched case-insensitively;
 * created if the brand doesn't have one yet).
 */
export const GOOGLE_SYSTEM_PRODUCT_NAME = "Collection";

/**
 * Substituted for the ad-group column when a google export doesn't have one
 * (campaign-level exports). A PRESENT-but-blank cell is still E042 — this only
 * covers an absent COLUMN.
 */
export const GOOGLE_ADSET_FALLBACK = "All";
