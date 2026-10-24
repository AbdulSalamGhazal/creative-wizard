import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userAccounts, users } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import { resolvePermissions, type RoleTier } from "@/lib/permissions";
import { ADMIN_SCOPE, type ManagerScope, type MemberAccess } from "@/lib/team-guard";

/**
 * The reads behind the Team guard (`lib/team-guard.ts`, D1). Users are not a
 * tenant table — a person spans brands — so nothing here is account-scoped;
 * brand MEMBERSHIP is exactly what is being read.
 */

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

/** A member's saved access (and email, for the audit label), or null. */
export async function memberAccess(
  userId: string,
): Promise<(MemberAccess & { email: string }) | null> {
  const [row] = await db
    .select({
      email: users.email,
      role: users.role,
      permissions: users.permissions,
      allAccounts: users.allAccounts,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  return {
    email: row.email,
    role: row.role as RoleTier,
    permissions: row.permissions ?? null,
    allAccounts: row.allAccounts,
    accountIds: row.allAccounts ? [] : await membershipIds(userId),
  };
}

/**
 * Every user, by name, with their brand memberships (the Team page; W3-8
 * moved it out of the page). Two reads, grouped in JS.
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
      })
      .from(users)
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
