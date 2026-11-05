import { z } from "zod";
import { METRIC_KEYS, type VersionData } from "./engine/types";

/**
 * The Zod schema of a version document — the ONE gate between the outside
 * world (an autosave body, a JSON import, a jsonb column read back) and the
 * engine's `VersionData`. Lenient where an older export may lack a field the
 * brief calls optional (`sku`, `notes`, `couponDiscount`, …); strict on shape.
 *
 * Numbers are finite: NaN/±∞ never enter storage (they are display states the
 * engine derives, never inputs).
 */
const num = z.number().finite();
const nonNeg = num.min(0);
const fraction = num.min(0).max(1);
const id = z.string().min(1).max(200);
const text = z.string().max(2000);

export const mechanicSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("percent"), qty: z.number().int().min(1), pct: fraction }),
  z.object({ kind: z.literal("amount"), qty: z.number().int().min(1), amount: nonNeg }),
  z.object({ kind: z.literal("bxgy"), buy: z.number().int().min(1), get: z.number().int().min(1) }),
  z.object({
    kind: z.literal("bxgy_pct"),
    buy: z.number().int().min(1),
    get: z.number().int().min(1),
    pct: fraction,
  }),
  z.object({ kind: z.literal("bundle"), qty: z.number().int().min(1), price: nonNeg }),
]);

export const settingsSchema = z.object({
  vatRate: fraction,
  pricesIncludeVat: z.boolean(),
  usdToSar: num.min(0.0001),
  deliveryRate: num.min(0.01).max(1),
  undeliveredCost: nonNeg,
});

export const offerSchema = z.object({
  id,
  name: z.string().max(200),
  mechanic: mechanicSchema,
  couponDiscount: fraction.default(0),
  adMode: z.enum(["cpa", "roas"]).default("cpa"),
  cpaUsd: nonNeg.default(0),
  platformRoas: num.min(0.01).default(4),
  deliveryRateOverride: num.min(0.01).max(1).nullable().default(null),
  ordersPerMonth: z.number().int().min(0).default(0),
  notes: text.default(""),
});

export const productSchema = z.object({
  id,
  name: z.string().max(200),
  sku: z.string().max(200).default(""),
  unitCost: nonNeg,
  price: nonNeg,
  colorSlot: z.number().int().min(0).max(7).default(0),
  offers: z.array(offerSchema),
  notes: text.default(""),
});

export const targetSchema = z.object({
  id,
  metric: z.enum(METRIC_KEYS),
  a: num,
  b: num,
  enabled: z.boolean().default(true),
});

export const planSchema = z.object({
  id,
  name: z.string().max(200),
  ordersPerDay: nonNeg,
  productShare: z.record(z.string(), num).default({}),
  offerShare: z.record(z.string(), num).default({}),
});

export const actualPeriodSchema = z.object({
  id,
  name: z.string().max(200),
  days: z.number().int().min(1),
  adSpendUsd: nonNeg,
  metaRoas: num.nullable().default(null),
  deliveryRate: num.min(0.01).max(1).nullable().default(null),
  orders: z.record(z.string(), nonNeg).default({}),
});

export const versionDataSchema = z
  .object({
    settings: settingsSchema,
    products: z.array(productSchema),
    targets: z.array(targetSchema).default([]),
    roasTargetId: z.string().default(""),
    plans: z.array(planSchema).min(1),
    activePlanId: z.string(),
    actuals: z.array(actualPeriodSchema).default([]),
  })
  .transform((d) => ({
    ...d,
    // An active plan that no longer exists falls back to the first one.
    activePlanId: d.plans.some((p) => p.id === d.activePlanId) ? d.activePlanId : d.plans[0]!.id,
  }));

/** Pins the schema's output to the engine's type: a drift fails to compile. */
const _typeCheck: z.ZodType<VersionData, z.ZodTypeDef, unknown> = versionDataSchema;
void _typeCheck;

export type VersionDataInput = z.input<typeof versionDataSchema>;
