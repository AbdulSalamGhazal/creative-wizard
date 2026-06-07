import { z } from "zod";
import { creativeTypeEnum, platformEnum } from "@/db/schema";
import { CREATIVE_STATUSES } from "@/lib/creative-status";

// Initial sketch; see docs/prd.md §5.1.
// The creative attribute set is expected to evolve during development.
// Status is no longer a manual attribute — it's derived dynamically (see
// lib/creative-status.ts), with per-platform termination as the only manual
// lever (creativeTerminationSchema below).
/**
 * The creative's source link (the live post/ad or asset URL). A single
 * optional http(s) URL. Preprocessing trims and treats blank as "unset"
 * (→ undefined) so an empty field clears the value instead of failing.
 */
export const sourceLinkSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
  z
    .string()
    .max(2048)
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "Must start with http:// or https://")
    .optional(),
);

export type SourceLinkInput = z.infer<typeof sourceLinkSchema>;

export const creativeCreateSchema = z.object({
  name: z.string().min(1).max(255),
  productId: z.string().uuid(),
  type: z.enum(creativeTypeEnum),
  thumbnailUrl: z.string().url().optional(),
  launchDate: z.string().date().optional(),
  notes: z.string().optional(),
  sourceLink: sourceLinkSchema,
  tags: z.array(z.string().min(1).max(64)).default([]),
});

export type CreativeCreateInput = z.infer<typeof creativeCreateSchema>;

/**
 * Manual per-platform termination lever. A creative is "Terminated" on a
 * platform when a `creative_platform_overrides` row exists for it; this schema
 * backs the detail header's Terminate / Reactivate buttons.
 */
export const creativeTerminationSchema = z.object({
  creativeId: z.string().uuid(),
  platform: z.enum(platformEnum),
  terminated: z.boolean(),
});

export type CreativeTerminationInput = z.infer<typeof creativeTerminationSchema>;

// -----------------------------------------------------------------------------
// Library URL filters (creator + launchFrom/launchTo deferred until a user
// picker and date-range primitive exist; PRD §5.1 lists both as required).
// -----------------------------------------------------------------------------

function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(values)))
    .catch([]);
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
  "product-asc",
  "product-desc",
  "type-asc",
  "type-desc",
  "status-asc",
  "status-desc",
  "tag-asc",
  "tag-desc",
  "spend7-desc",
  "spend7-asc",
  "spend-desc",
  "spend-asc",
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
  // Library status filter uses the NEW dynamic status set
  // (new|active|pause|terminated), NOT the OLD manual `creativeStatusEnum`.
  statuses: csvEnum(CREATIVE_STATUSES),
  // Keep only creatives with performance data on the selected platform(s).
  platforms: csvEnum(platformEnum),
  tags: csvString(),
  sort: z.enum(creativeSortValues).catch("launched-desc"),
  // Table is the default view; "grid" is the opt-in (carried as ?view=grid).
  view: z.enum(creativeViewValues).catch("table"),
});

export type CreativeListFilterInput = z.infer<typeof creativeListFiltersSchema>;
