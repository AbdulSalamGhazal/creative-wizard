import { z } from "zod";
import { platformEnum } from "@/db/schema";
import {
  BUDGET_OBJECTIVES,
  PLAN_MODES,
  mergeAllocationsToBuckets,
  type PlanMode,
} from "@/lib/budget";

/**
 * Budget module input schemas. Spend is USD, revenue SAR (see lib/budget.ts for
 * the standing currency decisions). Allocations are keyed by Budget's OWN
 * objective buckets (`BUDGET_OBJECTIVES`), not the campaign vocabulary.
 */

/** `YYYY-MM` with a REAL month (01-12) — `2026-13` is not a month. */
export const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Day-weight bounds — these MIRROR the Plan editor's clamp (0.5 step, 0.5..10)
 * so a hand-rolled request can't store a weight the UI could never produce.
 * `lib/budget.ts` `validateWeight` stays looser on purpose (> 0, ≤ 10): it
 * guards values READ back from the DB, where a legacy row may sit below 0.5 and
 * must keep working (and keep copying) rather than break the month.
 */
export const WEIGHT_MIN = 0.5;
export const WEIGHT_MAX = 10;

/** One day-grain cell of a daily-mode plan. */
export const planDayCellSchema = z.object({
  day: z.number().int().min(1).max(31),
  platform: z.enum(platformEnum),
  objective: z.enum(BUDGET_OBJECTIVES),
  plannedSpend: z.number().min(0).max(99_999_999),
});

/** Target ROAS bounds — SAR revenue per SAR of spend; 1000× is a fat finger. */
export const TARGET_ROAS_MAX = 1000;

/**
 * A month's whole plan — full-replace semantics (see replaceBudgetMonth).
 *
 * `mode` decides which half is the truth. `curve`: `allocations` + the day
 * weights, and `days` must be empty. `daily`: `days` (+ `targetRoas`), and
 * `allocations` is IGNORED — the writer derives it as the cells' sums, so a
 * client can never store allocations that disagree with its days.
 */
export const planSchema = z.object({
  month: z.string().regex(MONTH_KEY),
  allocations: z
    .array(
      z.object({
        platform: z.enum(platformEnum),
        objective: z.enum(BUDGET_OBJECTIVES),
        plannedSpend: z.number().min(0).max(99_999_999),
      }),
    )
    .max(platformEnum.length * BUDGET_OBJECTIVES.length),
  plannedRevenueSar: z.number().min(0).max(999_999_999_999).nullable(),
  /** The reserve (USD) — carved OUT of the total, not added on top of it, and
   *  outside the pacing curve (the curve paces the ALLOCATED plan only). */
  reserveSpendUsd: z.number().min(0).max(99_999_999).default(0),
  /** Only overridden days travel; weight 1 rows are dropped before persisting. */
  dayWeights: z
    .array(
      z.object({
        day: z.number().int().min(1).max(31),
        weight: z.number().min(WEIGHT_MIN).max(WEIGHT_MAX),
      }),
    )
    .max(31)
    .default([]),
  mode: z.enum(PLAN_MODES).default("curve"),
  days: z
    .array(planDayCellSchema)
    .max(31 * platformEnum.length * BUDGET_OBJECTIVES.length)
    .default([]),
  /** Daily mode's revenue link; must be null in curve mode. */
  targetRoas: z.number().positive().max(TARGET_ROAS_MAX).nullable().default(null),
}).superRefine((plan, ctx) => {
  if (plan.mode === "curve" && plan.days.length > 0) {
    ctx.addIssue({ code: "custom", message: "A curve-mode plan can't carry day cells." });
  }
  if (plan.mode === "curve" && plan.targetRoas !== null) {
    ctx.addIssue({ code: "custom", message: "A target ROAS is only for day-by-day plans." });
  }
});


/** A one-line "what changed?" stored on the revision. Optional everywhere. */
export const planNoteSchema = z.string().trim().max(200).optional();

/**
 * Where a save came from. The CSV upload is NOT a second writer — it goes
 * through `saveBudgetMonth` like the editor does, so it gets the same
 * `planSchema` validation, the same revision snapshot and the same audit row.
 * This field is the one thing that differs: it becomes the audit meta's `op`,
 * so the trail can still tell a typed plan from an uploaded one.
 */
export const planSourceSchema = z.enum(["editor", "upload"]).default("editor");

/**
 * Save = a plan plus the optional note that explains it, and where it came
 * from. The source PINS the mode: the editor writes curve plans, the upload
 * writes daily ones — so neither door can quietly open the other's mode.
 */
export const savePlanSchema = planSchema.and(
  z.object({ note: planNoteSchema, source: planSourceSchema }),
).superRefine((plan, ctx) => {
  const expected: PlanMode = plan.source === "upload" ? "daily" : "curve";
  if (plan.mode !== expected) {
    ctx.addIssue({
      code: "custom",
      message:
        plan.source === "upload"
          ? "An uploaded plan is a day-by-day plan."
          : "The editor saves curve plans — upload a sheet to plan day by day.",
    });
  }
});

/** Collapse a daily month back to editor planning (see convertPlanToCurve). */
export const convertPlanSchema = z.object({
  month: z.string().regex(MONTH_KEY),
  note: planNoteSchema,
});

/** Copy a plan from ANY month that has one (not just the previous month). */
export const copyPlanSchema = z
  .object({
    month: z.string().regex(MONTH_KEY),
    from: z.string().regex(MONTH_KEY),
  })
  .refine((v) => v.from !== v.month, {
    message: "Pick a different month to copy from.",
  });

export const restoreRevisionSchema = z.object({ revisionId: z.string().uuid() });

/**
 * The stored shape of a plan revision's `snapshot` jsonb. Deliberately
 * STRUCTURAL only — platform/objective are plain strings here so that an old
 * snapshot carrying a retired objective still PARSES, and then fails loudly at
 * `planSchema` when someone tries to restore it (rather than being silently
 * dropped, or half-applied).
 */
export const storedSnapshotSchema = z.object({
  allocations: z
    .array(
      z.object({
        platform: z.string(),
        objective: z.string(),
        plannedSpend: z.number(),
      }),
    )
    .default([]),
  plannedRevenueSar: z.number().nullable().default(null),
  reserveSpendUsd: z.number().default(0),
  /** `{ "15": 2 }` — only overridden days, same convention as the table. */
  dayWeights: z.record(z.string(), z.number()).default({}),
  /**
   * Plan mode (2026-09). Absent on every snapshot written before modes
   * existed — those were all curve plans, so the default IS the truth.
   */
  mode: z.enum(PLAN_MODES).default("curve"),
  /** Daily mode's cells; structural (strings) for the same reason as above. */
  days: z
    .array(
      z.object({
        day: z.number(),
        platform: z.string(),
        objective: z.string(),
        plannedSpend: z.number(),
      }),
    )
    .default([]),
  targetRoas: z.number().nullable().default(null),
});

export type BudgetPlanSnapshot = z.infer<typeof storedSnapshotSchema>;

/**
 * The snapshot re-shaped as a `planSchema` input, for validation + restore.
 *
 * Allocations are folded onto Budget's objective buckets on the way through: a
 * snapshot taken before the 2026-09 bucket change carries campaign objectives
 * (Sales, Prospecting, …), and restoring one must bring the money back as
 * "Other" rather than failing validation. Rows that collapse together are
 * SUMMED, so the restored month's planned total matches the snapshot's.
 */
export function snapshotToPlanInput(
  snapshot: BudgetPlanSnapshot,
  month: string,
): unknown {
  return {
    month,
    allocations: mergeAllocationsToBuckets(snapshot.allocations),
    plannedRevenueSar: snapshot.plannedRevenueSar,
    reserveSpendUsd: snapshot.reserveSpendUsd,
    dayWeights: Object.entries(snapshot.dayWeights).map(([day, weight]) => ({
      day: Number(day),
      weight,
    })),
    // The mode travels with the snapshot, so a restore re-applies the plan
    // the way it was planned.
    mode: snapshot.mode,
    days: snapshot.days,
    targetRoas: snapshot.mode === "daily" ? snapshot.targetRoas : null,
  };
}

/**
 * The plan as it stands after a write — what gets stored on the revision. Takes
 * the shape `replaceBudgetMonth` is given (day weights keyed by day), so the
 * snapshot and the rows written in the same transaction can't disagree.
 */
export function planInputToSnapshot(plan: {
  allocations: Array<{ platform: string; objective: string; plannedSpend: number }>;
  plannedRevenueSar: number | null;
  reserveSpendUsd?: number;
  dayWeights?: Record<number | string, number>;
  mode?: PlanMode;
  days?: Array<{ day: number; platform: string; objective: string; plannedSpend: number }>;
  targetRoas?: number | null;
}): BudgetPlanSnapshot {
  return {
    allocations: plan.allocations.map((a) => ({
      platform: a.platform,
      objective: a.objective,
      plannedSpend: a.plannedSpend,
    })),
    plannedRevenueSar: plan.plannedRevenueSar,
    reserveSpendUsd: plan.reserveSpendUsd ?? 0,
    dayWeights: Object.fromEntries(
      Object.entries(plan.dayWeights ?? {})
        .filter(([, w]) => w !== 1)
        .map(([day, w]) => [String(day), w]),
    ),
    mode: plan.mode ?? "curve",
    days: (plan.days ?? []).map((d) => ({
      day: d.day,
      platform: d.platform,
      objective: d.objective,
      plannedSpend: d.plannedSpend,
    })),
    targetRoas: plan.mode === "daily" ? (plan.targetRoas ?? null) : null,
  };
}
