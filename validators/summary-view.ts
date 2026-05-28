import { z } from "zod";

/**
 * Input for saving a view. `query` is the raw searchParams string (sans
 * leading "?"). We cap its length defensively — a legitimate Summary config
 * is well under 2 KB.
 */
export const createSummaryViewSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  query: z.string().max(2000),
  page: z.string().max(32).default("summary"),
});

export type CreateSummaryViewInput = z.infer<typeof createSummaryViewSchema>;
