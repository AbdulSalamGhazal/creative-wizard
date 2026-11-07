import { z } from "zod";
import { ENTITY_ACTIVITY_TYPES } from "@/lib/entity-activity";
import { MONTH_KEY } from "@/validators/budget";

/**
 * GET /api/entity-activity — one entity's history. The id's SHAPE per type (a
 * uuid, or `YYYY-MM` for a budget month); whether it belongs to the active
 * brand is the query layer's account scope.
 */
export const entityActivityQuerySchema = z
  .object({
    type: z.enum(ENTITY_ACTIVITY_TYPES),
    id: z.string().min(1).max(64),
    /** Cursor: only events older than this audit id. */
    before: z.coerce.number().int().positive().nullable().default(null),
  })
  .superRefine((v, ctx) => {
    const ok =
      v.type === "budget_month" ? MONTH_KEY.test(v.id) : z.string().uuid().safeParse(v.id).success;
    if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid entity", path: ["id"] });
  });
