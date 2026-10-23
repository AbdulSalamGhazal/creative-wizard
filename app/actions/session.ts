"use server";

import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth-cookie";
import {
  hashPassword,
  verifyPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "@/lib/auth-password";
import { auth, endSessions, requireAuth } from "@/lib/auth";
import { AUDIT_ACTIONS, logAudit, type AuditAction } from "@/lib/audit";
import { actionError } from "@/lib/action-error";
import {
  oldestAccountId,
  recentSignInFailures,
  SIGNIN_THROTTLE_MAX_FAILURES,
} from "@/db/queries/auth";

const signInSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

const changePasswordSchema = z
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

export interface SignInResult {
  ok: boolean;
  error?: string;
}

export interface ChangePasswordResult {
  ok: boolean;
  error?: string;
}

/**
 * Verify email + password. No password set on the user → instruct to ask admin.
 *
 * THROTTLED (D2, 2026-10-23): after SIGNIN_THROTTLE_MAX_FAILURES failed
 * attempts for an email inside the window, the next attempt is refused before
 * the user is looked up or a password verified — with the same generic
 * message, so it says nothing about whether the email exists — and audited as
 * `auth.signin_throttled`. Throttled attempts don't count as failures, so the
 * wait ends when the window slides past the fifth failure.
 *
 * Every anonymous auth event is filed under the OLDEST brand (D2): there is
 * no session, so the active-brand lookup inside `logAudit` would throw and
 * the row would be lost — which is how no failed sign-in was ever recorded.
 */
export async function signIn(formData: FormData): Promise<SignInResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error:
        first?.path[0] === "email"
          ? "Please enter a valid email address."
          : "Please enter your password.",
    };
  }
  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  // Generic message on lookup miss + wrong password so we don't leak which
  // emails exist.
  const genericError = "Wrong email or password.";

  const accountId = (await oldestAccountId()) ?? undefined;
  const auditAnonymous = (
    action: AuditAction,
    entityId: string | null,
    meta: Record<string, unknown>,
  ) =>
    logAudit({
      action,
      entityType: "auth",
      entityId,
      entityLabel: email,
      actorUserId: null,
      meta: { email, ...meta },
      accountId,
    });

  if ((await recentSignInFailures(email)) >= SIGNIN_THROTTLE_MAX_FAILURES) {
    await auditAnonymous(AUDIT_ACTIONS.AUTH_SIGNIN_THROTTLED, null, {});
    return { ok: false, error: genericError };
  }

  const [row] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(sql`LOWER(${users.email}) = ${email}`)
    .limit(1);

  if (!row) {
    await auditAnonymous(AUDIT_ACTIONS.AUTH_SIGNIN_FAILED, null, { reason: "user_not_found" });
    return { ok: false, error: genericError };
  }
  if (!row.passwordHash) {
    await auditAnonymous(AUDIT_ACTIONS.AUTH_SIGNIN_FAILED, row.id, { reason: "no_password_set" });
    return {
      ok: false,
      error:
        "This account has no password set yet. Ask an admin to set one for you.",
    };
  }
  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) {
    await auditAnonymous(AUDIT_ACTIONS.AUTH_SIGNIN_FAILED, row.id, { reason: "bad_password" });
    return { ok: false, error: genericError };
  }

  await setSessionCookie(row.id);
  await logAudit({
    action: AUDIT_ACTIONS.AUTH_SIGNIN,
    entityType: "auth",
    entityId: row.id,
    entityLabel: email,
    actorUserId: row.id,
    meta: { email },
  });
  return { ok: true };
}

/**
 * Sign out — EVERYWHERE (D3, 2026-10-23): every session this person has, on
 * every device, ends, not just this browser's cookie. Clearing only the local
 * cookie left a copied or forgotten one valid for its full 30 days.
 */
export async function signOut(): Promise<void> {
  // Capture identity before clearing the cookie so the audit row has an actor.
  const me = await auth();
  if (me) {
    // Audit FIRST: it resolves the brand through the session being ended.
    await logAudit({
      action: AUDIT_ACTIONS.AUTH_SIGNOUT,
      entityType: "auth",
      entityId: me.id,
      entityLabel: me.email,
      actorUserId: me.id,
    });
    await endSessions(me.id, new Date());
  }
  await clearSessionCookie();
  redirect("/signin");
}

/**
 * Self-service password change for the signed-in user. Ends the person's
 * OTHER sessions (D3): every cookie issued before now is signed out, and this
 * device is re-issued a fresh one so it stays signed in.
 */
export async function changePassword(input: unknown): Promise<ChangePasswordResult> {
  try {
    const me = await requireAuth();
    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { currentPassword, newPassword } = parsed.data;

    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, me.id))
      .limit(1);
    if (!row?.passwordHash) {
      return {
        ok: false,
        error:
          "No password is set on this account yet. Ask an admin to set one first.",
      };
    }
    const ok = await verifyPassword(currentPassword, row.passwordHash);
    if (!ok) {
      return { ok: false, error: "Current password is incorrect." };
    }
    const newHash = await hashPassword(newPassword);
    await db
      .update(users)
      .set({ passwordHash: newHash, sessionsRevokedAt: new Date() })
      .where(eq(users.id, me.id));
    // Signed at or after the stamp above, so this device stays signed in.
    await setSessionCookie(me.id);

    await logAudit({
      action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGE,
      entityType: "user",
      entityId: me.id,
      entityLabel: me.email,
      actorUserId: me.id,
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "session") };
  }
}
