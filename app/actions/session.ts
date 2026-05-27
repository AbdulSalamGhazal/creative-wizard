"use server";

import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth-cookie";

const emailSchema = z.string().email().max(255);

export interface SignInResult {
  ok: boolean;
  error?: string;
}

/**
 * Look the email up, set the session cookie. No password — PRD trade-off:
 * trusted-team-only access. Anyone whose row exists in `users` can sign in.
 */
export async function signIn(formData: FormData): Promise<SignInResult> {
  const rawEmail = formData.get("email");
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  const email = parsed.data.trim().toLowerCase();

  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`LOWER(${users.email}) = ${email}`)
    .limit(1);

  if (!row) {
    return {
      ok: false,
      error:
        "That email isn't on the team yet. Ask an admin to add you in /admin/users.",
    };
  }

  await setSessionCookie(row.id);
  return { ok: true };
}

export async function signOut(): Promise<void> {
  await clearSessionCookie();
  redirect("/signin");
}

/** Server-side helper that performs sign-out + redirect in one go. */
export async function signOutAndRedirect(): Promise<void> {
  await clearSessionCookie();
  redirect("/signin");
}

