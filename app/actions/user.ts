"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { users } from "@/db/schema";
import {
  hashPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "@/lib/auth-password";

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
  role: z.enum(["admin", "editor"]).default("editor"),
  password: passwordSchema,
});

const roleSchema = z.enum(["admin", "editor"]);

const setPasswordSchema = z.object({
  userId: z.string().uuid(),
  password: passwordSchema,
});

/**
 * Create a user with a starter password. Admin shares the password with the
 * teammate out-of-band; teammate can change it from the user menu.
 */
export async function inviteUser(input: unknown): Promise<UserMutationResult> {
  try {
    await requireAdmin();
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
    await db
      .insert(users)
      .values({ email: normalizedEmail, name, role, passwordHash: hash });

    try {
      revalidatePath("/admin/users");
    } catch (err) {
      console.warn("revalidatePath after invite failed:", err);
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
    const me = await requireAdmin();
    const parsed = roleSchema.safeParse(role);
    if (!parsed.success) return { ok: false, error: "Invalid role." };

    if (userId === me.id && parsed.data !== "admin") {
      return { ok: false, error: "You can't change your own role." };
    }

    await db.update(users).set({ role: parsed.data }).where(eq(users.id, userId));

    try {
      revalidatePath("/admin/users");
    } catch (err) {
      console.warn("revalidatePath after role change failed:", err);
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
 * Admin sets a password for any user — used to reset a forgotten password or
 * to give a passwordless legacy account a credential.
 */
export async function adminSetPassword(input: unknown): Promise<UserMutationResult> {
  try {
    await requireAdmin();
    const parsed = setPasswordSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const hash = await hashPassword(parsed.data.password);
    await db
      .update(users)
      .set({ passwordHash: hash })
      .where(eq(users.id, parsed.data.userId));

    try {
      revalidatePath("/admin/users");
    } catch (err) {
      console.warn("revalidatePath after admin set-password failed:", err);
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
