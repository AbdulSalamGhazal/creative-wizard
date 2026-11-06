import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * The member lifecycle (D4, 2026-11-06): deactivate · reactivate · end
 * sessions · remove, driven through the REAL actions, queries and database,
 * faking only who is signed in (the team-guard suite's harness). The other
 * half — what a deactivated or removed person's sign-in and cookie do — is
 * `team-lifecycle-auth.test.ts`, which runs the real `auth()`.
 */

const ADMIN = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures
const ADMIN2 = "dddddddd-0000-0000-0000-0000000000a2";
const LEAD = "dddddddd-0000-0000-0000-0000000000b1"; // users.manage, every brand, no admin
const JUNIOR = "dddddddd-0000-0000-0000-0000000000c3"; // within the lead's reach
const AUDITOR = "dddddddd-0000-0000-0000-0000000000c2"; // holds audit.view — beyond the lead

type Actor = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  permissions: string[] | null;
  allAccounts: boolean;
  avatarUrl: string | null;
};

const ACTORS = {
  admin: {
    id: ADMIN, email: "harness@test.local", name: "Harness", role: "admin",
    permissions: null, allAccounts: true, avatarUrl: null,
  },
  lead: {
    id: LEAD, email: "lead@test.local", name: "Lead", role: "editor",
    permissions: ["users.manage", "creative.create", "creative.edit"],
    allAccounts: true, avatarUrl: null,
  },
} satisfies Record<string, Actor>;

let actor: Actor = ACTORS.admin;

vi.mock("@/lib/auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...orig,
    auth: vi.fn(async () => actor),
    requireAuth: vi.fn(async () => actor),
    requirePermission: vi.fn(async (perm: string) => {
      if (!orig.can(actor as never, perm as never)) {
        throw new Error(`Missing permission: ${perm}`);
      }
      return actor;
    }),
  };
});

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  listAllAccounts: vi.fn(async () => [
    { id: ACCOUNT_A, name: "Account A" },
    { id: ACCOUNT_B, name: "Account B" },
  ]),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { db } from "@/lib/db";
import {
  apiTokens,
  auditEvents,
  notifications,
  userAccounts,
  userFilterPrefs,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth-password";
import {
  endUserSessions,
  inviteUser,
  memberRemovalPreview,
  removeUser,
  setUserStatus,
  updateUserAccess,
} from "@/app/actions/user";
import { listTeamWithMemberships, memberAccess } from "@/db/queries/team";
import { brandMembers } from "@/db/queries/notifications";
import { TEAM_REFUSAL } from "@/lib/team-guard";
import { resetAndSeed } from "./fixtures";

const PW = "original-password";

beforeEach(async () => {
  await resetAndSeed();
  const hash = await hashPassword(PW);
  await db.update(users).set({ passwordHash: hash }).where(eq(users.id, ADMIN));
  await db.insert(users).values([
    { id: ADMIN2, email: "admin2@test.local", name: "Second Admin", role: "admin", passwordHash: hash },
    { id: LEAD, email: "lead@test.local", name: "Lead", role: "editor", permissions: ACTORS.lead.permissions, passwordHash: hash },
    { id: JUNIOR, email: "junior@test.local", name: "Junior", role: "viewer", permissions: ["creative.edit"], allAccounts: false, passwordHash: hash },
    { id: AUDITOR, email: "auditor@test.local", name: "Auditor", role: "viewer", permissions: ["audit.view"], passwordHash: hash },
  ]);
  await db.insert(userAccounts).values([{ userId: JUNIOR, accountId: ACCOUNT_A }]);
  actor = ACTORS.admin;
});

async function row(id: string) {
  const [r] = await db
    .select({
      role: users.role,
      permissions: users.permissions,
      allAccounts: users.allAccounts,
      passwordHash: users.passwordHash,
      deactivatedAt: users.deactivatedAt,
      removedAt: users.removedAt,
      sessionsRevokedAt: users.sessionsRevokedAt,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, id));
  return r!;
}

async function audited(action: string, entityId: string) {
  return db
    .select({ actor: auditEvents.actorUserId, meta: auditEvents.meta })
    .from(auditEvents)
    .where(and(eq(auditEvents.action, action), eq(auditEvents.entityId, entityId)));
}

const teamIds = async () => (await listTeamWithMemberships()).map((m) => m.id).sort();

// ─── deactivate / reactivate ─────────────────────────────────────────────

describe("deactivate and reactivate", () => {
  it("stamps the person, ends their sessions, keeps them on the team, and is audited", async () => {
    expect(await setUserStatus({ userId: JUNIOR, active: false })).toEqual({ ok: true });
    const r = await row(JUNIOR);
    expect(r.deactivatedAt).not.toBeNull();
    expect(r.sessionsRevokedAt).not.toBeNull();
    expect(r.removedAt).toBeNull();
    // Access, brands and password are untouched — this is on hold, not gone.
    expect(r.permissions).toEqual(["creative.edit"]);
    expect(r.passwordHash).not.toBeNull();
    expect(await teamIds()).toContain(JUNIOR);
    expect(await audited("user.deactivate", JUNIOR)).toHaveLength(1);

    expect(await setUserStatus({ userId: JUNIOR, active: true })).toEqual({ ok: true });
    expect((await row(JUNIOR)).deactivatedAt).toBeNull();
    expect(await audited("user.reactivate", JUNIOR)).toHaveLength(1);
  });

  it("a no-op (already in that state) writes and audits nothing", async () => {
    expect(await setUserStatus({ userId: JUNIOR, active: true })).toEqual({ ok: true });
    expect(await audited("user.reactivate", JUNIOR)).toHaveLength(0);
  });

  it("never yourself", async () => {
    expect(await setUserStatus({ userId: ADMIN, active: false })).toEqual({
      ok: false,
      error: "You can't deactivate your own account.",
    });
  });

  it("never the last ACTIVE admin — a deactivated admin doesn't count", async () => {
    expect(await setUserStatus({ userId: ADMIN2, active: false })).toEqual({ ok: true });
    // Now the harness admin is the only one who can get in; demoting them is refused too.
    actor = { ...ACTORS.admin, id: ADMIN2, role: "admin" }; // act as the (deactivated) second admin
    expect(await setUserStatus({ userId: ADMIN, active: false })).toEqual({
      ok: false,
      error: "Can't deactivate the last admin.",
    });
    expect(await updateUserAccess({ userId: ADMIN, role: "editor", permissions: null })).toEqual({
      ok: false,
      error: "Can't remove the last admin.",
    });
    expect((await row(ADMIN)).deactivatedAt).toBeNull();
  });

  it("a deactivated member is not routable or mentionable; a reactivated one is again", async () => {
    const before = (await brandMembers()).map((m) => m.id);
    expect(before).toContain(JUNIOR);
    await setUserStatus({ userId: JUNIOR, active: false });
    expect((await brandMembers()).map((m) => m.id)).not.toContain(JUNIOR);
    await setUserStatus({ userId: JUNIOR, active: true });
    expect((await brandMembers()).map((m) => m.id)).toContain(JUNIOR);
  });

  it("below admin: only within the manager's access, never an admin", async () => {
    actor = ACTORS.lead;
    expect(await setUserStatus({ userId: JUNIOR, active: false })).toEqual({ ok: true });
    expect(await setUserStatus({ userId: AUDITOR, active: false })).toEqual({
      ok: false,
      error: TEAM_REFUSAL.statusBeyond,
    });
    expect(await setUserStatus({ userId: ADMIN2, active: false })).toEqual({
      ok: false,
      error: TEAM_REFUSAL.adminStatus,
    });
  });
});

// ─── end sessions ────────────────────────────────────────────────────────

describe("end sessions", () => {
  it("stamps, audits, and changes nothing else", async () => {
    const before = await row(JUNIOR);
    expect(await endUserSessions({ userId: JUNIOR })).toEqual({ ok: true });
    const after = await row(JUNIOR);
    expect(after.sessionsRevokedAt).not.toBeNull();
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.deactivatedAt).toBeNull();
    expect(await audited("user.sessions_end", JUNIOR)).toHaveLength(1);
  });
  it("not yourself (the account menu does that), and never an admin below admin", async () => {
    expect((await endUserSessions({ userId: ADMIN })).ok).toBe(false);
    actor = ACTORS.lead;
    expect(await endUserSessions({ userId: ADMIN2 })).toEqual({
      ok: false,
      error: TEAM_REFUSAL.adminSessions,
    });
    // A nuisance, not an escalation: someone with more access is fair game.
    expect(await endUserSessions({ userId: AUDITOR })).toEqual({ ok: true });
  });
});

// ─── remove ──────────────────────────────────────────────────────────────

describe("remove from the team", () => {
  beforeEach(async () => {
    // Give Junior a footprint and some reach to purge.
    await db.insert(apiTokens).values({
      userId: JUNIOR, name: "Claude", tokenHash: "hash-junior", prefix: "cwz_abcdefgh",
    });
    await db.insert(userFilterPrefs).values({
      userId: JUNIOR, accountId: ACCOUNT_A, filterKey: "platforms", values: ["instagram"],
    });
    await db.insert(notifications).values({
      accountId: ACCOUNT_A, recipientUserId: JUNIOR, category: "system", type: "brand.granted",
      title: "hello", href: "/",
    });
  });

  it("purges credentials and reach, frees the email, keeps the row for history, and is audited", async () => {
    const preview = await memberRemovalPreview({ userId: JUNIOR });
    expect(preview).toEqual({ ok: true, kept: { creatives: 0, uploads: 0, comments: 0 } });

    expect(await removeUser({ userId: JUNIOR })).toEqual({ ok: true });

    const r = await row(JUNIOR);
    expect(r.removedAt).not.toBeNull();
    expect(r.passwordHash).toBeNull();
    expect(r.sessionsRevokedAt).not.toBeNull();
    expect(r.allAccounts).toBe(false);
    expect(r.permissions).toEqual([]);
    expect(r.email).toBe("junior@test.local"); // kept for attribution and the audit label
    expect(await db.select().from(userAccounts).where(eq(userAccounts.userId, JUNIOR))).toHaveLength(0);
    expect(await db.select().from(apiTokens).where(eq(apiTokens.userId, JUNIOR))).toHaveLength(0);
    expect(await db.select().from(userFilterPrefs).where(eq(userFilterPrefs.userId, JUNIOR))).toHaveLength(0);
    expect(await db.select().from(notifications).where(eq(notifications.recipientUserId, JUNIOR))).toHaveLength(0);

    // Gone from every Team read…
    expect(await teamIds()).not.toContain(JUNIOR);
    expect(await memberAccess(JUNIOR)).toBeNull();
    expect((await brandMembers()).map((m) => m.id)).not.toContain(JUNIOR);
    // …and no Team action finds them again.
    expect(await setUserStatus({ userId: JUNIOR, active: true })).toEqual({ ok: false, error: "User not found." });

    const [event] = await audited("user.remove", JUNIOR);
    expect(event?.actor).toBe(ADMIN);
    expect(event?.meta).toMatchObject({ email: "junior@test.local", kept: { creatives: 0, uploads: 0, comments: 0 } });

    // The address is free: the same email can be invited again as a NEW row.
    const res = await inviteUser({ email: "junior@test.local", name: "Junior II", password: "starter-password", role: "viewer" });
    expect(res.ok).toBe(true);
    expect(res.userId).toBeDefined();
    expect(res.userId).not.toBe(JUNIOR);
    expect(await teamIds()).toContain(res.userId!);
  });

  it("inviting a DEACTIVATED person's email points at reactivation instead", async () => {
    await setUserStatus({ userId: JUNIOR, active: false });
    expect(await inviteUser({ email: "junior@test.local", name: "Junior", password: "starter-password", role: "viewer" })).toEqual({
      ok: false,
      error: "Junior is on the team but deactivated — reactivate them instead of inviting again.",
    });
  });

  it("never yourself, never the last active admin", async () => {
    expect(await removeUser({ userId: ADMIN })).toEqual({ ok: false, error: "You can't remove yourself from the team." });
    await setUserStatus({ userId: ADMIN2, active: false });
    actor = { ...ACTORS.admin, id: ADMIN2 };
    expect(await removeUser({ userId: ADMIN })).toEqual({ ok: false, error: "Can't remove the last admin." });
    expect((await row(ADMIN)).removedAt).toBeNull();
  });

  it("below admin: within the manager's access, never an admin", async () => {
    actor = ACTORS.lead;
    expect(await removeUser({ userId: AUDITOR })).toEqual({ ok: false, error: TEAM_REFUSAL.removeBeyond });
    expect(await removeUser({ userId: ADMIN2 })).toEqual({ ok: false, error: TEAM_REFUSAL.adminRemove });
    expect(await removeUser({ userId: JUNIOR })).toEqual({ ok: true });
  });
});
