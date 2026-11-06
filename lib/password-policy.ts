/**
 * The password length policy, dependency-free so a client dialog can read it
 * (D4, 2026-11-06). `lib/auth-password.ts` — bcrypt, server-only — re-exports
 * these; the Team page's dialogs used to hard-code the 8.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
