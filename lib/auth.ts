import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";

/**
 * STUB AUTH — temporary scaffold.
 *
 * Real Auth.js v5 wiring (Google provider, domain restriction, JWT sessions)
 * is the next slice. For now, every server-side caller is treated as the
 * seeded admin so Server Actions can pass a real user id into audit columns
 * like `excluded_by_user_id`.
 *
 * To swap for real auth:
 *  - Replace `auth()` with a call to Auth.js' `auth()` helper.
 *  - Move the seeded-admin lookup into a one-time bootstrap script.
 *  - Add the `signIn` callback that rejects emails outside AUTH_ALLOWED_DOMAIN
 *    and the role-bootstrap logic that promotes the first user to admin.
 *
 * Every call site here will continue to compile; only the internals change.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
}

let cachedUser: SessionUser | null = null;

async function loadAdminFromDb(): Promise<SessionUser> {
  if (cachedUser) return cachedUser;
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);

  if (!row) {
    throw new Error(
      "No admin user found in the database. Run `npm run db:seed` to bootstrap.",
    );
  }
  cachedUser = { ...row, role: row.role as SessionUser["role"] };
  return cachedUser;
}

/** Returns the current user, or null if not signed in. (Stub: always returns admin.) */
export async function auth(): Promise<SessionUser | null> {
  return loadAdminFromDb();
}

/** Throws when not authenticated. Use in Server Actions and Route Handlers. */
export async function requireAuth(): Promise<SessionUser> {
  const user = await auth();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

/** Throws when the user is not an admin. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.role !== "admin") {
    throw new Error("Admin role required");
  }
  return user;
}

/** Editor-or-above. Editors can upload CSVs, manage creatives, exclude records. */
export async function requireEditor(): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.role !== "admin" && user.role !== "editor") {
    throw new Error("Editor role required");
  }
  return user;
}
