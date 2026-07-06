"use server";

import { revalidatePath } from "next/cache";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { users } from "@/db/schema";
import {
  hashPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "@/lib/auth-password";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { isPermission } from "@/lib/permissions";

export interface UserMutationResult {
  ok: boolean;
  error?: string;
}

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `At least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH);

const inviteSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(255),
  role: z.enum(["admin", "editor", "viewer"]).default("editor"),
  password: passwordSchema,
});

const roleSchema = z.enum(["admin", "editor", "viewer"]);

const setPasswordSchema = z.object({
  userId: z.string().uuid(),
  password: passwordSchema,
});

const accessSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "editor", "viewer"]),
  // null → derive permissions from the role preset; an array → an explicit
  // ("custom") grant. Stale/unknown keys are filtered out before saving.
  permissions: z.array(z.string()).nullable(),
});

/**
 * Create a user with a starter password. Admin shares the password with the
 * teammate out-of-band; teammate can change it from the user menu.
 */
export async function inviteUser(input: unknown): Promise<UserMutationResult> {
  try {
    const me = await requirePermission("users.manage");
    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { email, name, role, password } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    if (existing) {
      return { ok: false, error: "Email already on the team." };
    }

    const hash = await hashPassword(password);
    const [inserted] = await db
      .insert(users)
      .values({ email: normalizedEmail, name, role, passwordHash: hash })
      .returning({ id: users.id });

    try {
      revalidatePath("/admin/users");
    } catch (err) {
      console.warn("revalidatePath after invite failed:", err);
    }
    if (inserted) {
      await logAudit({
        action: AUDIT_ACTIONS.USER_INVITE,
        entityType: "user",
        entityId: inserted.id,
        entityLabel: normalizedEmail,
        actorUserId: me.id,
        meta: { email: normalizedEmail, name, role },
      });
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function updateUserRole(
  userId: string,
  role: string,
): Promise<UserMutationResult> {
  try {
    const me = await requirePermission("users.manage");
    const parsed = roleSchema.safeParse(role);
    if (!parsed.success) return { ok: false, error: "Invalid role." };

    if (userId === me.id && parsed.data !== "admin") {
      return { ok: false, error: "You can't change your own role." };
    }

    const [before] = await db
      .select({ email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // Never let the last admin be demoted — the team would lock itself out.
    if (before?.role === "admin" && parsed.data !== "admin") {
      const [row] = await db
        .select({ n: count() })
        .from(users)
        .where(eq(users.role, "admin"));
      if ((row?.n ?? 0) <= 1) {
        return { ok: false, error: "Can't remove the last admin." };
      }
    }

    await db.update(users).set({ role: parsed.data }).where(eq(users.id, userId));

    try {
      revalidatePath("/admin/users");
    } catch (err) {
      console.warn("revalidatePath after role change failed:", err);
    }
    await logAudit({
      action: AUDIT_ACTIONS.USER_ROLE_CHANGE,
      entityType: "user",
      entityId: userId,
      entityLabel: before?.email ?? null,
      actorUserId: me.id,
      meta: { from: before?.role ?? null, to: parsed.data },
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Set a user's full access — role tier + explicit permission set — from the
 * `/admin/access` page. `permissions: null` means "derive from the role preset"
 * (the Admin/Editor/Viewer presets); a non-null array is a Custom grant.
 *
 * Guardrails: you can't edit your OWN access (no self-escalation), and you can't
 * demote the last admin (the team would lock itself out). Every change is
 * audited with the before/after role + permissions.
 */
export async function updateUserAccess(
  input: unknown,
): Promise<UserMutationResult> {
  try {
    const me = await requirePermission("users.manage");
    const parsed = accessSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { userId, role } = parsed.data;

    if (userId === me.id) {
      return { ok: false, error: "You can't change your own access." };
    }

    // Admins bypass every check, so an explicit set is meaningless for them —
    // store NULL. Otherwise keep only real catalog keys (drop stale/unknown).
    const permissions =
      role === "admin" || parsed.data.permissions === null
        ? null
        : parsed.data.permissions.filter(isPermission);

    const [before] = await db
      .select({
        email: users.email,
        role: users.role,
        permissions: users.permissions,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!before) return { ok: false, error: "User not found." };

    // Never let the last admin be demoted.
    if (before.role === "admin" && role !== "admin") {
      const [row] = await db
        .select({ n: count() })
        .from(users)
        .where(eq(users.role, "admin"));
      if ((row?.n ?? 0) <= 1) {
        return { ok: false, error: "Can't remove the last admin." };
      }
    }

    await db
      .update(users)
      .set({ role, permissions })
      .where(eq(users.id, userId));

    try {
      revalidatePath("/admin/access");
      revalidatePath("/admin/users");
    } catch (err) {
      console.warn("revalidatePath after access change failed:", err);
    }
    await logAudit({
      action: AUDIT_ACTIONS.USER_PERMISSIONS_UPDATE,
      entityType: "user",
      entityId: userId,
      entityLabel: before.email,
      actorUserId: me.id,
      meta: {
        from: { role: before.role, permissions: before.permissions },
        to: { role, permissions },
      },
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Admin sets a password for any user — used to reset a forgotten password or
 * to give a passwordless legacy account a credential.
 */
export async function adminSetPassword(input: unknown): Promise<UserMutationResult> {
  try {
    const me = await requirePermission("users.manage");
    const parsed = setPasswordSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const hash = await hashPassword(parsed.data.password);
    const [target] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, parsed.data.userId))
      .limit(1);
    await db
      .update(users)
      .set({ passwordHash: hash })
      .where(eq(users.id, parsed.data.userId));

    try {
      revalidatePath("/admin/users");
    } catch (err) {
      console.warn("revalidatePath after admin set-password failed:", err);
    }
    await logAudit({
      action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
      entityType: "user",
      entityId: parsed.data.userId,
      entityLabel: target?.email ?? null,
      actorUserId: me.id,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
