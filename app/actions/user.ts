"use server";

import { revalidatePath } from "next/cache";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { accounts, userAccounts, users } from "@/db/schema";
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
  // Brand membership. `allAccounts` true (default) → every brand incl. future
  // ones; false → only the listed brands (≥1 required, validated below).
  allAccounts: z.boolean().default(true),
  accountIds: z.array(z.string().uuid()).default([]),
});

const brandsSchema = z.object({
  userId: z.string().uuid(),
  allAccounts: z.boolean(),
  accountIds: z.array(z.string().uuid()).default([]),
});

/**
 * Resolve the brands to grant: admins are ALWAYS all-brands; otherwise keep only
 * ids that name a real account (dedup). Returns the normalized flag + id list,
 * or an error string when a restricted grant names zero valid brands.
 */
async function resolveGrant(
  role: "admin" | "editor" | "viewer",
  allAccounts: boolean,
  accountIds: string[],
): Promise<{ allAccounts: boolean; accountIds: string[] } | { error: string }> {
  if (role === "admin" || allAccounts) {
    return { allAccounts: true, accountIds: [] };
  }
  const existing = await db.select({ id: accounts.id }).from(accounts);
  const valid = new Set(existing.map((r) => r.id));
  const ids = [...new Set(accountIds.filter((id) => valid.has(id)))];
  if (ids.length === 0) return { error: "Select at least one brand." };
  return { allAccounts: false, accountIds: ids };
}

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

    const grant = await resolveGrant(
      role,
      parsed.data.allAccounts,
      parsed.data.accountIds,
    );
    if ("error" in grant) return { ok: false, error: grant.error };

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    if (existing) {
      return { ok: false, error: "Email already on the team." };
    }

    const hash = await hashPassword(password);
    const inserted = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          email: normalizedEmail,
          name,
          role,
          passwordHash: hash,
          allAccounts: grant.allAccounts,
        })
        .returning({ id: users.id });
      if (created && !grant.allAccounts && grant.accountIds.length) {
        await tx.insert(userAccounts).values(
          grant.accountIds.map((accountId) => ({ userId: created.id, accountId })),
        );
      }
      return created;
    });

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
        meta: {
          email: normalizedEmail,
          name,
          role,
          allAccounts: grant.allAccounts,
          accountIds: grant.accountIds,
        },
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

/**
 * Set a user's full access — role tier + explicit permission set — from the
 * Team page (`/admin/users`). `permissions: null` means "derive from the role
 * preset" (the Admin/Editor/Viewer presets); a non-null array is a Custom grant.
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
 * Set a user's BRAND membership (WHERE they can work) — the counterpart to
 * `updateUserAccess` (WHAT they can do). `allAccounts: true` → every brand,
 * including brands created later; `false` → only `accountIds` (≥1 required).
 *
 * Guardrails mirror the access card: you can't change your OWN brand access,
 * admins are forced all-brands, and the before/after is audited
 * (`user.brands_update`).
 */
export async function updateUserBrands(
  input: unknown,
): Promise<UserMutationResult> {
  try {
    const me = await requirePermission("users.manage");
    const parsed = brandsSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { userId } = parsed.data;
    if (userId === me.id) {
      return { ok: false, error: "You can't change your own brand access." };
    }

    const [target] = await db
      .select({
        email: users.email,
        role: users.role,
        allAccounts: users.allAccounts,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!target) return { ok: false, error: "User not found." };

    const grant = await resolveGrant(
      target.role as "admin" | "editor" | "viewer",
      parsed.data.allAccounts,
      parsed.data.accountIds,
    );
    if ("error" in grant) return { ok: false, error: grant.error };

    // Snapshot the current memberships for the audit before/after.
    const beforeIds = (
      await db
        .select({ accountId: userAccounts.accountId })
        .from(userAccounts)
        .where(eq(userAccounts.userId, userId))
    ).map((r) => r.accountId);

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ allAccounts: grant.allAccounts })
        .where(eq(users.id, userId));
      // Full replace: clear then re-insert the exact set (empty for all-brands).
      await tx.delete(userAccounts).where(eq(userAccounts.userId, userId));
      if (!grant.allAccounts && grant.accountIds.length) {
        await tx
          .insert(userAccounts)
          .values(grant.accountIds.map((accountId) => ({ userId, accountId })));
      }
    });

    try {
      revalidatePath("/admin/users");
    } catch (err) {
      console.warn("revalidatePath after brands change failed:", err);
    }
    await logAudit({
      action: AUDIT_ACTIONS.USER_BRANDS_UPDATE,
      entityType: "user",
      entityId: userId,
      entityLabel: target.email,
      actorUserId: me.id,
      meta: {
        from: { allAccounts: target.allAccounts, accountIds: beforeIds.sort() },
        to: {
          allAccounts: grant.allAccounts,
          accountIds: [...grant.accountIds].sort(),
        },
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
