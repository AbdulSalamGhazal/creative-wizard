import { z } from "zod";
import { platformEnum } from "@/db/schema";
import { CREATIVE_STATUSES } from "@/lib/creative-status";
import { STAGE_FILTER_VALUES } from "@/lib/funnel-stages";
import { parseCanvasView } from "@/lib/canvas";

/**
 * URL-state filters for the Canvas page. A bad value drops the filter rather
 * than throwing. The date range is NOT defaulted here: the page resolves it
 * server-side (`resolvePreferredRange` → saved range → last 30 days) so the
 * picker's label and the query's bounds are one value.
 */
function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(values)))
    .catch([]);
}

/**
 * Creative statuses shown when the URL names none: everything but Terminated.
 * A terminated creative is one the team has already ruled on, so by default
 * it isn't part of the picture; the Status filter brings it back.
 */
export const CANVAS_DEFAULT_STATUSES = CREATIVE_STATUSES.filter(
  (s) => s !== "terminated",
);

export const canvasFiltersSchema = z.object({
  from: z.string().date().optional().catch(undefined),
  to: z.string().date().optional().catch(undefined),
  platforms: csvEnum(platformEnum),
  statuses: csvEnum(CREATIVE_STATUSES),
  productIds: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []))
    .pipe(z.array(z.string().uuid()))
    .catch([]),
  stages: csvEnum(STAGE_FILTER_VALUES),
  /**
   * `?view=` — network (default) · campaign · creative. URL-backed ON PURPOSE:
   * a comment snapshots the query string, so its reader lands on the exact
   * view it was written about. The client reads the same param through the
   * same `parseCanvasView`, so server and client can't disagree.
   */
  view: z
    .string()
    .optional()
    .catch(undefined)
    .transform((v) => parseCanvasView(v)),
});
