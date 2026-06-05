import { z } from "zod";
import { platformEnum } from "@/db/schema";

/** The three threshold fields, shared by the default + per-platform schemas. */
const ratingFields = {
  minSpend: z.coerce
    .number()
    .min(0, "Minimum spend can't be negative")
    .max(10_000_000, "That spend threshold is unrealistically high"),
  goodRoas: z.coerce
    .number()
    .gt(0, "Good ROAS must be greater than 0")
    .max(1000, "ROAS cutoff is unrealistically high"),
  decentRoas: z.coerce
    .number()
    .gt(0, "Decent ROAS must be greater than 0")
    .max(1000, "ROAS cutoff is unrealistically high"),
};

const GOOD_ABOVE_DECENT = {
  message: "Good ROAS must be higher than Decent ROAS",
  path: ["goodRoas"],
};

/**
 * Validates an update to the default rating rules. Cutoffs must be positive,
 * and Good must sit strictly above Decent (otherwise the tiers collapse).
 */
export const ratingRulesSchema = z
  .object(ratingFields)
  .refine((v) => v.goodRoas > v.decentRoas, GOOD_ABOVE_DECENT);

export type RatingRulesInput = z.infer<typeof ratingRulesSchema>;

/** Validates a per-platform override (same fields + the target platform). */
export const platformRatingRulesSchema = z
  .object({ platform: z.enum(platformEnum), ...ratingFields })
  .refine((v) => v.goodRoas > v.decentRoas, GOOD_ABOVE_DECENT);

export type PlatformRatingRulesInput = z.infer<typeof platformRatingRulesSchema>;

/** Validates a request to clear a platform override (revert to default). */
export const clearPlatformRatingSchema = z.object({
  platform: z.enum(platformEnum),
});
