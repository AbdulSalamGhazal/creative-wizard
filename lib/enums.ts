import { ALL_PLATFORMS } from "@/lib/palette";
import { CAMPAIGN_OBJECTIVES } from "@/lib/campaign";

/**
 * The vocabularies the database stores, in a module the BROWSER can import
 * (W2-6, 2026-10). They used to live only in `db/schema.ts`, and `db/schema`
 * runs `pgTable(…)` at module scope — it can't be tree-shaken — so every
 * client component or validator that read `platformEnum` shipped all 42
 * tables, every table and column name and drizzle's SQL builder to the
 * browser (13 KB gz on 11 routes, and a public map of the schema).
 *
 * `db/schema.ts` re-exports these, so the DB and the UI still share ONE list
 * each — DERIVE, don't re-list. Client-reachable code imports them from HERE;
 * `app/client-bundle.test.ts` fails if a client module reaches `@/db/schema`.
 */

/** Platforms — `ALL_PLATFORMS` (lib/palette) is the root. */
export const platformEnum = ALL_PLATFORMS;

/** Creative types. Display order and labels: `TYPE_ORDER` / `TYPE_LABEL`
 *  (lib/palette), keyed by `CreativeType` so a new type fails to compile there. */
export const creativeTypeEnum = ["video", "slides", "image"] as const;
export type CreativeType = (typeof creativeTypeEnum)[number];

/** The coarse role tier on `users.role` (granular permissions sit on top). */
export const roleEnum = ["admin", "editor", "viewer"] as const;
export type RoleTier = (typeof roleEnum)[number];

/** What an exclusion rule targets. */
export const exclusionRuleKindEnum = [
  "campaign_objective",
  "campaign",
  "creative",
] as const;
export type ExclusionRuleKind = (typeof exclusionRuleKindEnum)[number];

/** A Store order field's value type. */
export const storeFieldTypeEnum = ["text", "number", "date"] as const;
export type StoreFieldType = (typeof storeFieldTypeEnum)[number];

/** Campaign objectives — `CAMPAIGN_OBJECTIVES` (lib/campaign) is the root. */
export const campaignObjectiveEnum = CAMPAIGN_OBJECTIVES;
