import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

/**
 * A network address read from a request header (F1, 2026-10-24) — the key
 * the sign-in throttle counts by. Bounded and shaped like an IP, or it is not
 * an address at all: a header carrying anything else reads as "no address",
 * never as a fresh throttle key. Lower-cased so one IPv6 address is one key.
 */
export const clientIpSchema = z
  .string()
  .trim()
  .max(64)
  .ip()
  .transform((s) => s.toLowerCase());

/** Sign-in form (`signIn`, app/actions/session.ts). Moved here 2026-11-19. */
export const signInSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

/** Self-service password change (`changePassword`). Moved here 2026-11-19. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `At least ${PASSWORD_MIN_LENGTH} characters.`)
      .max(PASSWORD_MAX_LENGTH),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "New passwords don't match.",
    path: ["confirmPassword"],
  });
