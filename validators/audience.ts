import { z } from "zod";
import { platformEnum } from "@/db/schema";
import { FUNNEL_STAGES } from "@/lib/audience";
import { isValidIsoDate } from "@/lib/budget";

/**
 * Funnel-audience input schemas. Sizes are whole people; dates are the day the
 * audience was MEASURED. Stages derive from `FUNNEL_STAGES` (the budget buckets
 * minus "Other"), platforms from `platformEnum` — neither is re-listed here.
 */

/** A real calendar date. `2026-02-30` is not one. */
export const isoDateSchema = z
  .string()
  .refine((v): v is string => isValidIsoDate(v), "Not a real date");

/** An audience big enough to hold everyone, and no bigger. */
export const audienceSizeSchema = z.number().int().min(0).max(2_000_000_000);

export const audienceEntrySchema = z.object({
  platform: z.enum(platformEnum),
  stage: z.enum(FUNNEL_STAGES),
  size: audienceSizeSchema,
});

/**
 * One date's measurements. Entries the user didn't touch are simply not sent —
 * a single-cell entry is a complete, valid record, so the only floor is one.
 * The ceiling is the full matrix (every platform × every stage).
 */
export const recordAudienceSchema = z.object({
  date: isoDateSchema,
  entries: z
    .array(audienceEntrySchema)
    .min(1, "Type at least one size.")
    .max(platformEnum.length * FUNNEL_STAGES.length),
});

/** A correction to one stored measurement. */
export const updateAudienceSchema = z.object({
  id: z.string().uuid(),
  size: audienceSizeSchema,
});

export const deleteAudienceSchema = z.object({ id: z.string().uuid() });

export type RecordAudienceInput = z.infer<typeof recordAudienceSchema>;
