import { z } from "zod";

// To be filled out; see docs/prd.md §5.2.
export const productCreateSchema = z.object({
  name: z.string().min(1).max(255),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
