import { z } from "zod";

export const setActiveAccountSchema = z.object({
  accountId: z.string().uuid(),
});

export const createAccountSchema = z.object({
  name: z.string().trim().min(1, "Brand name is required").max(120, "Too long"),
});

export const renameAccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Brand name is required").max(120, "Too long"),
});
