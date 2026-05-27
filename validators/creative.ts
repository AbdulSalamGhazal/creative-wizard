import { z } from "zod";
import { creativeStatusEnum, creativeTypeEnum } from "@/db/schema";

// Initial sketch; see docs/prd.md §5.1.
// The creative attribute set is expected to evolve during development.
export const creativeCreateSchema = z.object({
  name: z.string().min(1).max(255),
  productId: z.string().uuid(),
  type: z.enum(creativeTypeEnum),
  status: z.enum(creativeStatusEnum).default("draft"),
  thumbnailUrl: z.string().url().optional(),
  launchDate: z.string().date().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string().min(1).max(64)).default([]),
});

export type CreativeCreateInput = z.infer<typeof creativeCreateSchema>;
