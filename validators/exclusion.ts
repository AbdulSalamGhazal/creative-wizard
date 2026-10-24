import { z } from "zod";

// docs/prd.md §5.5: reason is required and capped at 200 chars.
export const excludeSchema = z.object({
  reason: z.string().min(1).max(200),
});

