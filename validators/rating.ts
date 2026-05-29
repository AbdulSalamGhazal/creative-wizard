import { z } from "zod";

/**
 * Validates an update to the rating rules. Cutoffs must be positive, and Good
 * must sit strictly above Decent (otherwise the tiers collapse / invert). The
 * refine keeps the relationship coherent regardless of input order.
 */
export const ratingRulesSchema = z
  .object({
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
  })
  .refine((v) => v.goodRoas > v.decentRoas, {
    message: "Good ROAS must be higher than Decent ROAS",
    path: ["goodRoas"],
  });

export type RatingRulesInput = z.infer<typeof ratingRulesSchema>;
