import { z } from "zod";
import { isValidLandingCode, LANDING_CODE_MAX } from "@/lib/landing-code";

/**
 * A landing page as the Library's Landing pages tab submits it. The code is
 * typed WITHOUT the `@` (the field shows it as a fixed prefix); a pasted
 * leading `@` is forgiven. Description is optional — blank stores NULL.
 */
export const landingPageInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(255),
  code: z
    .string()
    .trim()
    .transform((v) => v.replace(/^@/, ""))
    .pipe(
      z
        .string()
        .min(1, "Code is required.")
        .max(LANDING_CODE_MAX, `Code is at most ${LANDING_CODE_MAX} characters.`)
        .refine(isValidLandingCode, "Use letters, digits, - or _ only."),
    ),
  url: z
    .string()
    .trim()
    .min(1, "Link is required.")
    .url("Enter the full link, starting with https://.")
    .refine((v) => /^https?:\/\//i.test(v), "The link must start with http:// or https://."),
  description: z
    .string()
    .trim()
    .max(200, "Keep the description under 200 characters.")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export const landingPageUpdateSchema = landingPageInputSchema.extend({
  id: z.string().uuid(),
});

export type LandingPageInput = z.infer<typeof landingPageInputSchema>;
