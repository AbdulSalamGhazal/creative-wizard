import { z } from "zod";
import { COMMENT_ANCHOR_TYPES } from "@/lib/comments";
import { ACTIVITY_WHO } from "@/lib/activity";
import { csvEnum } from "@/validators/shared";

/**
 * The URL params of /activity. Every field FALLS BACK rather than throws — a
 * stale bookmark or a hand-typed URL still renders the feed, and a comma list
 * drops only its bad tokens (`csvEnum`, W3-1).
 */
export const activityParamsSchema = z.object({
  who: z.enum(ACTIVITY_WHO).catch("all"),
  types: csvEnum(COMMENT_ANCHOR_TYPES),
  q: z
    .string()
    .optional()
    .catch(undefined)
    .transform((s) => (s && s.trim() ? s.trim() : "")),
  page: z.coerce.number().int().min(1).catch(1),
});
