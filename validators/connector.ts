import { z } from "zod";

/**
 * What the Urjwan Connector sends (webhook batches and the read API). LENIENT
 * on purpose: the guide says any field may be null, and the raw payload is
 * stored whole whatever its shape — so these schemas read only what Wizard
 * APPLIES and pass everything else through untouched. A field that is the
 * wrong type becomes `undefined`, never a rejected batch: a `4xx` makes the
 * connector drop the whole batch without a retry.
 */

const text = z.string().nullish().catch(undefined);
/** The connector sends money as numbers; a numeric string is tolerated. */
const amount = z.union([z.number(), z.string()]).nullish().catch(undefined);

export const connectorOrderSchema = z
  .object({
    reference: z.union([z.string(), z.number()]).nullish().catch(undefined),
    created_at: text,
    updated_at: text,
    status: z
      .object({ slug: text, label: text })
      .passthrough()
      .nullish()
      .catch(undefined),
    currency: text,
    /** SAR per 1 unit of `currency` (1 for SAR). */
    exchange_rate: amount,
    /** Each line is read on its own (`connectorItemSchema`): one bad line never drops the rest. */
    items: z.array(z.unknown()).nullish().catch(undefined),
    amounts: z
      .object({ total: amount, total_sar: amount })
      .passthrough()
      .nullish()
      .catch(undefined),
    customer: z
      .object({ name: text, phone: text, email: text })
      .passthrough()
      .nullish()
      .catch(undefined),
    attribution: z
      .object({ utm_source: text, device: text })
      .passthrough()
      .nullish()
      .catch(undefined),
  })
  .passthrough();

export type ConnectorOrder = z.infer<typeof connectorOrderSchema>;

/** One `order.items[]` line: `total` is incl. VAT, in the order's currency. */
export const connectorItemSchema = z
  .object({
    sku: text,
    name: text,
    quantity: amount,
    total: amount,
  })
  .passthrough();

export const connectorEventSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: z.string().min(1).max(48),
    store: z.string().min(1).max(48),
    occurred_at: text,
    data: z.record(z.unknown()).nullish().catch(undefined),
  })
  .passthrough();

export type ConnectorEvent = z.infer<typeof connectorEventSchema>;

/** A webhook body. An event that isn't even an object is dropped, not fatal. */
export const connectorBatchSchema = z.object({
  events: z.array(z.unknown()).max(1000),
});

/** One page of `GET /api/v1/orders`. */
export const connectorOrdersPageSchema = z.object({
  data: z.array(z.record(z.unknown())),
  next_cursor: z.string().nullish(),
});
