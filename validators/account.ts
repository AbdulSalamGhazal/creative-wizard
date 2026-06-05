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

export const setStatusWindowSchema = z.object({
  id: z.string().uuid(),
  // "Active" window in hours. 1h–720h (30d); daily-grain data rounds to days.
  hours: z.coerce
    .number()
    .int("Whole hours only")
    .min(1, "At least 1 hour")
    .max(720, "At most 720 hours (30 days)"),
});
