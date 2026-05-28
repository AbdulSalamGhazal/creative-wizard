import { z } from "zod";
import { platformEnum, creativeTypeEnum, creativeStatusEnum } from "@/db/schema";

/**
 * URL-state validator for the Summary view.
 *
 * Extends the dashboard filter shape with:
 *  - `q` — free-text search on creative name (case-insensitive contains)
 *  - `creatorIds` — narrow to creatives authored by specific team members
 *  - `sort` / `dir` — column + direction
 *
 * The platform filter is **hard-capped to 3 server-side** — the table
 * renders three platform groups max, and a 4th would either get silently
 * dropped or break the layout. We clamp with `.slice(0, 3)` rather than
 * rejecting because URLs get shared and an invalid one shouldn't 500.
 */

function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(values)));
}

function csv() {
  return z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []));
}

export const MAX_PLATFORMS = 3;

/** Identity columns + per-platform metric keys. Validated against the
 *  selected platforms in the page; an invalid combination falls back to
 *  the default sort. */
export const SORT_DIRS = ["asc", "desc"] as const;
export type SortDir = (typeof SORT_DIRS)[number];

/** Free-form sort key. Validated against allowed shapes in the page; we
 *  accept any reasonable identifier here and let the page fall back if it
 *  references a hidden platform. */
const sortKeySchema = z
  .string()
  .regex(/^[a-z_]+(\.[a-z_]+)?$/i, "Invalid sort key")
  .max(48);

export const summaryFiltersSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  q: z
    .string()
    .max(255)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  productIds: csv(),
  // Cap platforms at MAX_PLATFORMS — silently truncate so a copy-pasted
  // URL with four platforms still renders something coherent.
  platforms: csvEnum(platformEnum).transform((arr) =>
    arr.slice(0, MAX_PLATFORMS),
  ),
  types: csvEnum(creativeTypeEnum),
  statuses: csvEnum(creativeStatusEnum),
  tags: csv(),
  creatorIds: csv(),
  includeExcluded: z
    .string()
    .optional()
    .transform((s) => s === "1" || s === "true"),
  sort: sortKeySchema.optional(),
  dir: z.enum(SORT_DIRS).optional(),
});

export type SummaryFilters = z.infer<typeof summaryFiltersSchema>;
