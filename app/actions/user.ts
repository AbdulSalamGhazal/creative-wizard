"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { users } from "@/db/schema";

export interface UserMutationResult {
  ok: boolean;
  error?: string;
}

const inviteSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(255),
  role: z.enum(["admin", "editor"]).default("editor"),
});

const roleSchema = z.enum(["admin", "editor"]);

/**
 * Stub invite — creates the User row in the DB so they appear in the team
 * list. No email is sent. When Auth.js v5 lands, replace this with the real
 * invite flow (or just let the user sign in with Google for the first time
 * and auto-create the row in the signIn callback).
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
    const { email, name, role } = parsed.data;

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) {
      return { ok: false, error: "Email already on the team." };
    }

    await db.insert(users).values({ email, name, role });

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

    // Don't let an admin demote themselves; we'd lose the only admin in dev.
    if (userId === me.id && parsed.data !== "admin") {
      return {
        ok: false,
        error: "You can't change your own role.",
      };
    }

    await db
      .update(users)
      .set({ role: parsed.data })
      .where(eq(users.id, userId));

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
