import { z } from "zod";
import { creativeTypeEnum, platformEnum } from "@/db/schema";
import { CREATIVE_STATUSES } from "@/lib/creative-status";
import { PRIORITY_FILTER_VALUES } from "@/lib/priority";
import {
  CREATIVE_STAGE_OPTIONS,
  NA_STAGE,
  STAGE_FILTER_VALUES,
  sortStages,
} from "@/lib/funnel-stages";

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

/**
 * Manual PRIORITY — the team's own judgment of a creative's importance,
 * independent of performance. Integer 1..3 (3 = highest), shown as a 1..3 icon
 * control on the detail page. `null` = unrated (a real, default state — never a
 * numeric 0, never auto-set). Deliberately DISTINCT from the computed
 * performance concept in `lib/rating.ts` / `rating_rules` (the ROAS-driven
 * "Rate"): Rate = computed performance, Priority = the team's manual judgment.
 */
export const prioritySchema = z.number().int().min(1).max(3).nullable();

export type PriorityInput = z.infer<typeof prioritySchema>;

/**
 * Manual STAGE(S) — where the team declares this creative sits in the funnel.
 * Any 1..3 of `FUNNEL_STAGES`, or the exclusive `N/A`; empty = unassigned.
 * THREE STATES: unassigned = "not yet declared", N/A = "declared: no clear
 * stage", otherwise the declared stages (see lib/funnel-stages.ts).
 *
 * NEVER auto-derived — not from the campaign objective it happens to run
 * under, not from where it spends. A creative declared Retargeting running in
 * an Awareness campaign is information, not an error.
 *
 * Deduped and kept in funnel order, so `{Retargeting, Awareness, Awareness}`
 * stores as `[Awareness, Retargeting]` and a set never depends on click order.
 */
export const stagesSchema = z
  .array(z.enum(CREATIVE_STAGE_OPTIONS))
  .max(CREATIVE_STAGE_OPTIONS.length)
  // N/A is EXCLUSIVE — "no clear stage" and "Awareness" can't both be true.
  // The picker normalizes to that; this REJECTS it, so a hand-rolled request
  // can never store the contradiction.
  .refine((v) => !v.includes(NA_STAGE) || v.length === 1, {
    message: `"${NA_STAGE}" can't be combined with a funnel stage.`,
  })
  .transform((v) => sortStages(v));

export type StagesInput = z.infer<typeof stagesSchema>;

export const creativeCreateSchema = z.object({
  name: z.string().min(1).max(255),
  productId: z.string().uuid(),
  type: z.enum(creativeTypeEnum),
  thumbnailUrl: z.string().url().optional(),
  launchDate: z.string().date().optional(),
  notes: z.string().optional(),
  sourceLink: sourceLinkSchema,
  angles: z.array(z.string().min(1).max(64)).default([]),
  stages: stagesSchema.default([]),
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
  const allowed = new Set<string>(values);
  // Drop only the INVALID tokens, keeping valid siblings — a single stale value
  // (e.g. a legacy `platforms=meta` link) must not silently disable the whole
  // filter. (The old `.pipe(z.array(z.enum)).catch([])` reset the entire array
  // to [] on any bad token.)
  return z
    .string()
    .optional()
    .transform((s) =>
      (s ? s.split(",").filter(Boolean) : []).filter(
        (v): v is T[number] => allowed.has(v),
      ),
    );
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
  "angle-asc",
  "angle-desc",
  "spend7-desc",
  "spend7-asc",
  "spend-desc",
  "spend-asc",
  "priority-desc",
  "priority-asc",
  "stage-asc",
  "stage-desc",
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
  angles: csvString(),
  // Manual Priority: 3 · 2 · 1 · Unrated (a first-class choice, not an absence).
  priorities: csvEnum(PRIORITY_FILTER_VALUES),
  // Manual Stage, OVERLAP semantics: a creative matches if ANY selected stage
  // is on it; "unassigned" matches an empty set.
  stages: csvEnum(STAGE_FILTER_VALUES),
  sort: z.enum(creativeSortValues).catch("launched-desc"),
  // Table is the default view; "grid" is the opt-in (carried as ?view=grid).
  view: z.enum(creativeViewValues).catch("table"),
});

export type CreativeListFilterInput = z.infer<typeof creativeListFiltersSchema>;

/**
 * The creative detail page's inline-edit patch (`patchCreative` in
 * app/actions/creative.ts). Every field is optional; only the fields present
 * are written.
 *
 * "Is there anything to update?" is DERIVED from the object's own keys —
 * every key except the non-field `id`. It used to be a hand-written list of
 * fields, and `stages` was never added to it when the field shipped, so a
 * patch changing ONLY the stage failed with "No fields to update." Derived,
 * the next field added here can't repeat that.
 */
export const creativePatchSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(255).optional(),
    productId: z.string().uuid().optional(),
    type: z.enum(creativeTypeEnum).optional(),
    thumbnailUrl: z.string().url().nullable().optional(),
    launchDate: z
      .string()
      .date()
      .nullable()
      .optional()
      .transform((v) => (v ? v : v === null ? null : undefined)),
    // Manual Priority (1..3; null = unrated). Sent only when changed.
    priority: prioritySchema.optional(),
    // Manual Stage(s). Sent only when changed; [] clears to unassigned.
    stages: stagesSchema.optional(),
    angles: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .refine(
    (d) => Object.entries(d).some(([key, value]) => key !== "id" && value !== undefined),
    { message: "No fields to update." },
  );
