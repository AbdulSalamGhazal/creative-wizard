import { z } from "zod";
import { platformEnum } from "@/db/schema";
import { CAMPAIGN_OBJECTIVES } from "@/lib/campaign";

/**
 * Budget module input schemas. Spend is USD, revenue SAR (see lib/budget.ts for
 * the standing currency decisions).
 */

export const MONTH_KEY = /^\d{4}-\d{2}$/;

/**
 * Day-weight bounds — these MIRROR the Plan editor's clamp (0.5 step, 0.5..10)
 * so a hand-rolled request can't store a weight the UI could never produce.
 * `lib/budget.ts` `validateWeight` stays looser on purpose (> 0, ≤ 10): it
 * guards values READ back from the DB, where a legacy row may sit below 0.5 and
 * must keep working (and keep copying) rather than break the month.
 */
export const WEIGHT_MIN = 0.5;
export const WEIGHT_MAX = 10;

/** A month's whole plan — full-replace semantics (see replaceBudgetMonth). */
export const planSchema = z.object({
  month: z.string().regex(MONTH_KEY),
  allocations: z
    .array(
      z.object({
        platform: z.enum(platformEnum),
        objective: z.enum(CAMPAIGN_OBJECTIVES),
        plannedSpend: z.number().min(0).max(99_999_999),
      }),
    )
    .max(platformEnum.length * CAMPAIGN_OBJECTIVES.length),
  plannedRevenueSar: z.number().min(0).max(999_999_999_999).nullable(),
  /** Contingency USD on top of the plan — outside the pacing curve. */
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
});

export type BudgetPlanInput = z.infer<typeof planSchema>;
