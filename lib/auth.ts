import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { readSessionUserId } from "@/lib/auth-cookie";

/**
 * Open-by-email auth (PRD trade-off).
 *
 * The session cookie carries a user id. `auth()` reads it, validates the
 * HMAC signature, and looks the user up. `requireAuth/requireAdmin/requireEditor`
 * throw on missing or insufficient role — the caller (a Server Action or
 * Route Handler) should catch these and return 401/403.
 *
 * If you need to swap to real Google OAuth later, replace the body of
 * `auth()` with an Auth.js call; the public shape stays.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
}

/**
 * `cache()` deduplicates within a single request — multiple components on the
 * same page calling `auth()` only hit the DB once.
 */
export const auth = cache(async (): Promise<SessionUser | null> => {
  const userId = await readSessionUserId();
  if (!userId) return null;

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;
  return { ...row, role: row.role as SessionUser["role"] };
});

export async function requireAuth(): Promise<SessionUser> {
  const user = await auth();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.role !== "admin") throw new Error("Admin role required");
  return user;
}

export async function requireEditor(): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.role !== "admin" && user.role !== "editor") {
    throw new Error("Editor role required");
  }
  return user;
}
