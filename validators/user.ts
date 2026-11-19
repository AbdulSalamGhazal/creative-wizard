import { z } from "zod";
import { roleEnum } from "@/lib/enums";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

/**
 * Team-page inputs (`app/actions/user.ts`). Moved here verbatim from the action
 * (2026-11-19) so every input schema lives in `validators/` as CLAUDE.md says —
 * the same checks and the same messages.
 */

export const userIdSchema = z.object({ userId: z.string().uuid() });

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `At least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH);

export const inviteSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(255),
  role: z.enum(roleEnum).default("editor"),
  password: passwordSchema,
  // Brand membership. `allAccounts` true (default) → every brand incl. future
  // ones; false → only the listed brands (≥1 required, validated below).
  allAccounts: z.boolean().default(true),
  accountIds: z.array(z.string().uuid()).default([]),
});

export const brandsSchema = z.object({
  userId: z.string().uuid(),
  allAccounts: z.boolean(),
  accountIds: z.array(z.string().uuid()).default([]),
});

export const setPasswordSchema = z.object({
  userId: z.string().uuid(),
  password: passwordSchema,
});

export const accessSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(roleEnum),
  // null → derive permissions from the role preset; an array → an explicit
  // ("custom") grant. Stale/unknown keys are filtered out before saving.
  permissions: z.array(z.string()).nullable(),
});

/** Deactivate / reactivate a member. */
export const statusSchema = userIdSchema.extend({ active: z.boolean() });
