import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  comments,
  creatives,
  storeUploadBatches,
  uploadBatches,
  userAccounts,
  users,
} from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import { resolvePermissions, type RoleTier } from "@/lib/permissions";
import { ADMIN_SCOPE, type ManagerScope, type MemberAccess } from "@/lib/team-guard";
import type { MemberFootprint } from "@/lib/team-member";

/**
 * The reads behind the Team guard (`lib/team-guard.ts`, D1). Users are not a
 * tenant table — a person spans brands — so nothing here is account-scoped;
 * brand MEMBERSHIP is exactly what is being read.
 *
 * Since D4 (2026-11-06) every read here excludes REMOVED members: a removed
 * row exists only so history keeps its names, and no Team surface or action
 * may find it again (its email is free for a new invite, which gets a new
 * row). Deactivated members are returned — they are still on the team.
 */

/** A member who is still on the team (active or deactivated). */
const onTeam = isNull(users.removedAt);

/** A `db` or a transaction — the admin count runs inside the writer's. */
type Exec = Pick<typeof db, "select">;

async function membershipIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ accountId: userAccounts.accountId })
    .from(userAccounts)
    .where(eq(userAccounts.userId, userId));
  return rows.map((r) => r.accountId);
}

/**
 * What `me` may hand out on the Team page. Admins get everything without a
 * read; below admin, the effective permission set plus — when restricted —
 * the brands they belong to.
 */
export async function managerScope(
  me: Pick<SessionUser, "id" | "role" | "permissions" | "allAccounts">,
): Promise<ManagerScope> {
  if (me.role === "admin") return ADMIN_SCOPE;
  return {
    isAdmin: false,
    permissions: [...resolvePermissions(me.role, me.permissions)],
    allAccounts: me.allAccounts,
    accountIds: me.allAccounts ? [] : await membershipIds(me.id),
  };
}

/** A member's saved access (plus what the audit label and the UI need), or null. */
export async function memberAccess(
  userId: string,
): Promise<
  | (MemberAccess & {
      email: string;
      name: string;
      deactivatedAt: Date | null;
      avatarUrl: string | null;
    })
  | null
> {
  const [row] = await db
    .select({
      email: users.email,
      name: users.name,
      role: users.role,
      permissions: users.permissions,
      allAccounts: users.allAccounts,
      deactivatedAt: users.deactivatedAt,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(and(eq(users.id, userId), onTeam))
    .limit(1);
  if (!row) return null;
  return {
    email: row.email,
    name: row.name,
    role: row.role as RoleTier,
    permissions: row.permissions ?? null,
    allAccounts: row.allAccounts,
    accountIds: row.allAccounts ? [] : await membershipIds(userId),
    deactivatedAt: row.deactivatedAt,
    avatarUrl: row.avatarUrl,
  };
}

/**
 * Every member still on the team, by name, with their brand memberships
 * (the Team page; W3-8 moved it out of the page). Two reads, grouped in JS.
 */
export async function listTeamWithMemberships() {
  const [team, memberships] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        permissions: users.permissions,
        allAccounts: users.allAccounts,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
        deactivatedAt: users.deactivatedAt,
        lastSignInAt: users.lastSignInAt,
      })
      .from(users)
      .where(onTeam)
      .orderBy(asc(users.name)),
    db
      .select({ userId: userAccounts.userId, accountId: userAccounts.accountId })
      .from(userAccounts),
  ]);
  const byUser = new Map<string, string[]>();
  for (const m of memberships) {
    const arr = byUser.get(m.userId);
    if (arr) arr.push(m.accountId);
    else byUser.set(m.userId, [m.accountId]);
  }
  return team.map((u) => ({ ...u, accountIds: byUser.get(u.id) ?? [] }));
}

/** One member of the Team page, with every brand they belong to. */
export type TeamMemberRow = Awaited<ReturnType<typeof listTeamWithMemberships>>[number];

/**
 * How many ACTIVE admins there are — the "last admin" rule's count. Runs on
 * the caller's transaction and locks the rows `FOR UPDATE`, so two admins
 * demoting (or deactivating, or removing) each other at once can't both see
 * two and leave none (2026-10-31). A deactivated admin can't sign in, so
 * they don't count: the team needs an admin who can actually get in.
 */
export async function lockActiveAdminCount(tx: Exec): Promise<number> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), isNull(users.deactivatedAt), onTeam))
    .for("update");
  return rows.length;
}

/**
 * What a member leaves behind — the Remove dialog's reassurance (ux-standards
 * "Economy": an unrecoverable action previews what it touches). Removal KEEPS
 * all of this attributed to them; the counts say so. Across every brand,
 * because a person is global.
 */
export type { MemberFootprint };

export async function memberFootprint(userId: string): Promise<MemberFootprint> {
  const [[c], [u], [s], [m]] = await Promise.all([
    db.select({ n: count() }).from(creatives).where(eq(creatives.createdByUserId, userId)),
    db.select({ n: count() }).from(uploadBatches).where(eq(uploadBatches.uploadedByUserId, userId)),
    db
      .select({ n: count() })
      .from(storeUploadBatches)
      .where(eq(storeUploadBatches.uploadedByUserId, userId)),
    db
      .select({ n: count() })
      .from(comments)
      .where(and(eq(comments.authorUserId, userId), isNull(comments.deletedAt))),
  ]);
  return {
    creatives: c?.n ?? 0,
    uploads: (u?.n ?? 0) + (s?.n ?? 0),
    comments: m?.n ?? 0,
  };
}

/**
 * Is `email` already held by someone on the team? Returns their lifecycle so
 * the invite can say "deactivated — reactivate instead" rather than a bare
 * duplicate. Removed rows don't count: their address is free (the partial
 * unique index `users_email_active_uq` says the same thing to the database).
 */
export async function teamMemberByEmail(
  email: string,
): Promise<{ id: string; name: string; deactivatedAt: Date | null } | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name, deactivatedAt: users.deactivatedAt })
    .from(users)
    .where(and(sql`LOWER(${users.email}) = ${email.toLowerCase()}`, onTeam))
    .limit(1);
  return row ?? null;
}
