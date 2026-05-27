import { z } from "zod";
import { creativeStatusEnum, creativeTypeEnum } from "@/db/schema";

// Initial sketch; see docs/prd.md §5.1.
// The creative attribute set is expected to evolve during development.
export const creativeCreateSchema = z.object({
  name: z.string().min(1).max(255),
  productId: z.string().uuid(),
  type: z.enum(creativeTypeEnum),
  status: z.enum(creativeStatusEnum).default("draft"),
  thumbnailUrl: z.string().url().optional(),
  launchDate: z.string().date().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string().min(1).max(64)).default([]),
});

export type CreativeCreateInput = z.infer<typeof creativeCreateSchema>;

// -----------------------------------------------------------------------------
// Library URL filters (creator + launchFrom/launchTo deferred until a user
// picker and date-range primitive exist; PRD §5.1 lists both as required).
// -----------------------------------------------------------------------------

function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(values)));
}

function csvString() {
  return z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []));
}

export const creativeSortValues = [
  "launched-desc",
  "launched-asc",
  "name-asc",
  "name-desc",
  "spend-desc",
  "created-desc",
] as const;
export type CreativeSort = (typeof creativeSortValues)[number];

export const creativeViewValues = ["grid", "table"] as const;
export type CreativeView = (typeof creativeViewValues)[number];

export const creativeListFiltersSchema = z.object({
  q: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() ? s.trim() : undefined)),
  productIds: csvString(),
  types: csvEnum(creativeTypeEnum),
  statuses: csvEnum(creativeStatusEnum),
  tags: csvString(),
  sort: z.enum(creativeSortValues).catch("launched-desc"),
  view: z.enum(creativeViewValues).catch("grid"),
});

export type CreativeListFilterInput = z.infer<typeof creativeListFiltersSchema>;
