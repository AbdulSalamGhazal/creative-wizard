import { z } from "zod";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** URL filters for the Store orders table — date range + order-id search ONLY. */
export const storeOrdersFiltersSchema = z.object({
  from: z.string().regex(ISO).optional(),
  to: z.string().regex(ISO).optional(),
  q: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() ? s.trim() : undefined)),
  page: z.coerce.number().int().min(1).catch(1),
  sort: z.enum(["order_id", "order_date", "total_amount"]).catch("order_date"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
});

export type StoreOrdersFilterInput = z.infer<typeof storeOrdersFiltersSchema>;
