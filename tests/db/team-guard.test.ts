import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * "Manage users & access" BELOW ADMIN (audit B-01 / decision D1, 2026-10-23).
 *
 * Before this, every Team mutation checked only `requirePermission
 * ("users.manage")`, so a non-admin holder could mint an admin, promote
 * anyone to admin, take over the admin's account with a password reset, and
 * hand out permissions and brands they never had. One guard (`teamGuard`,
 * lib/team-guard.ts) now runs on every path; these tests drive each path
 * through the REAL action, the real queries and the real database, faking
 * only who is signed in.
 */

const ADMIN = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures
const ADMIN2 = "dddddddd-0000-0000-0000-0000000000a2";
// A non-admin holder with every brand.
const LEAD = "dddddddd-0000-0000-0000-0000000000b1";
// A non-admin holder restricted to brand A.
const RLEAD = "dddddddd-0000-0000-0000-0000000000b2";
// Targets.
const PEER = "dddddddd-0000-0000-0000-0000000000c1"; // editor preset, every brand
const AUDITOR = "dddddddd-0000-0000-0000-0000000000c2"; // holds audit.view
const JUNIOR = "dddddddd-0000-0000-0000-0000000000c3"; // within both leads' reach
const SPLIT = "dddddddd-0000-0000-0000-0000000000c4"; // brands A + B
const BONLY = "dddddddd-0000-0000-0000-0000000000c5"; // brand B only

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
  rlead: {
    id: RLEAD, email: "rlead@test.local", name: "Restricted Lead", role: "editor",
    permissions: ["users.manage", "creative.edit"], allAccounts: false, avatarUrl: null,
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
import { userAccounts, users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth-password";
import {
  adminSetPassword,
  inviteUser,
  updateUserAccess,
  updateUserBrands,
} from "@/app/actions/user";
import { removeUserAvatar } from "@/app/actions/avatar";
import { POST as avatarRoute } from "@/app/api/uploads/avatar/route";
import { resetAndSeed } from "./fixtures";

const ORIGINAL_PW = "original-password";
// Not one of OUR stored URLs, so removing it never touches a file or the blob store.
const PHOTO = "https://example.test/admin-photo.webp";

beforeEach(async () => {
  await resetAndSeed();
  const hash = await hashPassword(ORIGINAL_PW);
  await db.update(users).set({ passwordHash: hash, avatarUrl: PHOTO }).where(eq(users.id, ADMIN));
  await db.insert(users).values([
    { id: ADMIN2, email: "admin2@test.local", name: "Second Admin", role: "admin", passwordHash: hash },
    { ...pick(ACTORS.lead), passwordHash: hash },
    { ...pick(ACTORS.rlead), passwordHash: hash },
    { id: PEER, email: "peer@test.local", name: "Peer", role: "editor", permissions: null, passwordHash: hash },
    { id: AUDITOR, email: "auditor@test.local", name: "Auditor", role: "viewer", permissions: ["audit.view"], passwordHash: hash },
    { id: JUNIOR, email: "junior@test.local", name: "Junior", role: "viewer", permissions: ["creative.edit"], allAccounts: false, passwordHash: hash },
    { id: SPLIT, email: "split@test.local", name: "Split", role: "viewer", permissions: [], allAccounts: false, passwordHash: hash },
    { id: BONLY, email: "bonly@test.local", name: "B Only", role: "viewer", permissions: [], allAccounts: false, passwordHash: hash },
  ]);
  await db.insert(userAccounts).values([
    { userId: RLEAD, accountId: ACCOUNT_A },
    { userId: JUNIOR, accountId: ACCOUNT_A },
    { userId: SPLIT, accountId: ACCOUNT_A },
    { userId: SPLIT, accountId: ACCOUNT_B },
    { userId: BONLY, accountId: ACCOUNT_B },
  ]);
  actor = ACTORS.admin;
});

function pick(a: Actor) {
  return {
    id: a.id, email: a.email, name: a.name, role: a.role,
    permissions: a.permissions, allAccounts: a.allAccounts,
  };
}

async function row(id: string) {
  const [r] = await db
    .select({
      role: users.role,
      permissions: users.permissions,
      allAccounts: users.allAccounts,
      passwordHash: users.passwordHash,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, id));
  return r!;
}

async function brandsOf(id: string) {
  return (
    await db.select({ a: userAccounts.accountId }).from(userAccounts).where(eq(userAccounts.userId, id))
  ).map((r) => r.a).sort();
}

async function byEmail(email: string) {
  const [r] = await db
    .select({ id: users.id, role: users.role, allAccounts: users.allAccounts })
    .from(users)
    .where(eq(users.email, email));
  return r ?? null;
}

const invite = (over: Record<string, unknown>) =>
  inviteUser({ email: "new@test.local", name: "New", password: "starter-password", ...over });

// ─── invite ──────────────────────────────────────────────────────────────

describe("invite — below admin", () => {
  it("can't create an admin", async () => {
    actor = ACTORS.lead;
    const res = await invite({ role: "admin" });
    expect(res).toEqual({ ok: false, error: "Only an admin can make someone an admin." });
    expect(await byEmail("new@test.local")).toBeNull();
  });

  it("can't invite an Editor when the preset holds permissions they don't", async () => {
    actor = ACTORS.lead; // lacks creative.delete, the first preset key past theirs
    const res = await invite({ role: "editor" });
    expect(res).toEqual({
      ok: false,
      error: "You can't grant «Delete creatives (removes their records)» — you don't have it yourself.",
    });
    expect(await byEmail("new@test.local")).toBeNull();
  });

  it("can invite a Viewer", async () => {
    actor = ACTORS.lead;
    expect(await invite({ role: "viewer" })).toEqual({ ok: true });
    expect((await byEmail("new@test.local"))?.role).toBe("viewer");
  });

  it("a restricted holder can't grant every brand", async () => {
    actor = ACTORS.rlead;
    const res = await invite({ role: "viewer", allAccounts: true });
    expect(res).toEqual({ ok: false, error: "Only someone with every brand can grant every brand." });
    expect(await byEmail("new@test.local")).toBeNull();
  });

  it("a restricted holder can't grant a brand they don't belong to", async () => {
    actor = ACTORS.rlead;
    const res = await invite({ role: "viewer", allAccounts: false, accountIds: [ACCOUNT_A, ACCOUNT_B] });
    expect(res).toEqual({ ok: false, error: "You can only grant brands you belong to." });
    expect(await byEmail("new@test.local")).toBeNull();
  });

  it("a restricted holder can grant their own brand", async () => {
    actor = ACTORS.rlead;
    expect(await invite({ role: "viewer", allAccounts: false, accountIds: [ACCOUNT_A] })).toEqual({ ok: true });
    const created = await byEmail("new@test.local");
    expect(created?.allAccounts).toBe(false);
    expect(await brandsOf(created!.id)).toEqual([ACCOUNT_A]);
  });

  it("an admin still can create an admin", async () => {
    expect(await invite({ role: "admin" })).toEqual({ ok: true });
    expect((await byEmail("new@test.local"))?.role).toBe("admin");
  });
});

// ─── access (role + permissions) ─────────────────────────────────────────

describe("access — below admin", () => {
  it("can't promote someone to admin", async () => {
    actor = ACTORS.lead;
    const res = await updateUserAccess({ userId: JUNIOR, role: "admin", permissions: null });
    expect(res).toEqual({ ok: false, error: "Only an admin can make someone an admin." });
    expect((await row(JUNIOR)).role).toBe("viewer");
  });

  it("can't change an admin's access", async () => {
    actor = ACTORS.lead;
    const res = await updateUserAccess({ userId: ADMIN, role: "viewer", permissions: null });
    expect(res).toEqual({ ok: false, error: "Only an admin can change an admin's access." });
    expect((await row(ADMIN)).role).toBe("admin");
  });

  it("can grant a permission they hold — users.manage included", async () => {
    actor = ACTORS.lead;
    const res = await updateUserAccess({
      userId: JUNIOR, role: "viewer", permissions: ["creative.edit", "creative.create", "users.manage"],
    });
    expect(res).toEqual({ ok: true });
    expect([...((await row(JUNIOR)).permissions ?? [])].sort()).toEqual(
      ["creative.create", "creative.edit", "users.manage"],
    );
  });

  it("can't grant a permission they don't hold", async () => {
    actor = ACTORS.lead;
    const res = await updateUserAccess({
      userId: JUNIOR, role: "viewer", permissions: ["creative.edit", "audit.view"],
    });
    expect(res).toEqual({
      ok: false,
      error: "You can't grant «View audit log» — you don't have it yourself.",
    });
    expect((await row(JUNIOR)).permissions).toEqual(["creative.edit"]);
  });

  it("can't remove a permission they don't hold", async () => {
    actor = ACTORS.lead;
    const res = await updateUserAccess({ userId: AUDITOR, role: "viewer", permissions: [] });
    expect(res).toEqual({
      ok: false,
      error: "You can't remove «View audit log» — you don't have it yourself.",
    });
    expect((await row(AUDITOR)).permissions).toEqual(["audit.view"]);
  });

  it("can change what they hold while leaving what they don't untouched", async () => {
    actor = ACTORS.lead;
    const res = await updateUserAccess({
      userId: AUDITOR, role: "viewer", permissions: ["audit.view", "creative.edit"],
    });
    expect(res).toEqual({ ok: true });
    expect([...((await row(AUDITOR)).permissions ?? [])].sort()).toEqual(["audit.view", "creative.edit"]);
  });

  it("the Editor preset is judged by what it grants", async () => {
    actor = ACTORS.lead;
    const res = await updateUserAccess({ userId: JUNIOR, role: "editor", permissions: null });
    expect(res.ok).toBe(false);
    expect(res.error).toBe(
      "You can't grant «Delete creatives (removes their records)» — you don't have it yourself.",
    );
    expect((await row(JUNIOR)).role).toBe("viewer");
  });

  it("still can't change their own access", async () => {
    actor = ACTORS.lead;
    const res = await updateUserAccess({ userId: LEAD, role: "viewer", permissions: ["users.manage"] });
    expect(res).toEqual({ ok: false, error: "You can't change your own access." });
  });

  it("an admin still can promote, and demote another admin", async () => {
    expect(await updateUserAccess({ userId: JUNIOR, role: "admin", permissions: null })).toEqual({ ok: true });
    expect((await row(JUNIOR)).role).toBe("admin");
    expect(await updateUserAccess({ userId: ADMIN2, role: "viewer", permissions: null })).toEqual({ ok: true });
    expect((await row(ADMIN2)).role).toBe("viewer");
  });
});

// ─── brands ──────────────────────────────────────────────────────────────

describe("brands — below admin", () => {
  it("can't change an admin's brands", async () => {
    actor = ACTORS.lead;
    const res = await updateUserBrands({ userId: ADMIN2, allAccounts: false, accountIds: [ACCOUNT_A] });
    expect(res).toEqual({ ok: false, error: "Only an admin can change an admin's brands." });
    expect((await row(ADMIN2)).allAccounts).toBe(true);
  });

  it("a holder with every brand can grant every brand", async () => {
    actor = ACTORS.lead;
    expect(await updateUserBrands({ userId: JUNIOR, allAccounts: true, accountIds: [] })).toEqual({ ok: true });
    expect((await row(JUNIOR)).allAccounts).toBe(true);
  });

  it("a restricted holder can't grant every brand", async () => {
    actor = ACTORS.rlead;
    const res = await updateUserBrands({ userId: JUNIOR, allAccounts: true, accountIds: [] });
    expect(res).toEqual({ ok: false, error: "Only someone with every brand can grant every brand." });
    expect((await row(JUNIOR)).allAccounts).toBe(false);
  });

  it("a restricted holder can't grant a brand they don't belong to", async () => {
    actor = ACTORS.rlead;
    const res = await updateUserBrands({ userId: JUNIOR, allAccounts: false, accountIds: [ACCOUNT_A, ACCOUNT_B] });
    expect(res).toEqual({ ok: false, error: "You can only grant brands you belong to." });
    expect(await brandsOf(JUNIOR)).toEqual([ACCOUNT_A]);
  });

  it("a restricted holder can't remove a brand they don't belong to", async () => {
    actor = ACTORS.rlead;
    const res = await updateUserBrands({ userId: SPLIT, allAccounts: false, accountIds: [ACCOUNT_A] });
    expect(res).toEqual({ ok: false, error: "You can only remove brands you belong to." });
    expect(await brandsOf(SPLIT)).toEqual([ACCOUNT_A, ACCOUNT_B].sort());
  });

  it("a restricted holder can't narrow someone who has every brand", async () => {
    actor = ACTORS.rlead;
    const res = await updateUserBrands({ userId: PEER, allAccounts: false, accountIds: [ACCOUNT_A] });
    expect(res).toEqual({ ok: false, error: "Only someone with every brand can change this person's brands." });
    expect((await row(PEER)).allAccounts).toBe(true);
  });

  it("a restricted holder can add their own brand beside one they don't have", async () => {
    actor = ACTORS.rlead;
    expect(
      await updateUserBrands({ userId: BONLY, allAccounts: false, accountIds: [ACCOUNT_A, ACCOUNT_B] }),
    ).toEqual({ ok: true });
    expect(await brandsOf(BONLY)).toEqual([ACCOUNT_A, ACCOUNT_B].sort());
  });

  it("still can't change their own brands", async () => {
    actor = ACTORS.rlead;
    const res = await updateUserBrands({ userId: RLEAD, allAccounts: true, accountIds: [] });
    expect(res).toEqual({ ok: false, error: "You can't change your own brand access." });
  });
});

// ─── password ────────────────────────────────────────────────────────────

describe("password — below admin", () => {
  it("can't set an admin's password", async () => {
    actor = ACTORS.lead;
    const res = await adminSetPassword({ userId: ADMIN, password: "taken-over-pw" });
    expect(res).toEqual({ ok: false, error: "Only an admin can set an admin's password." });
    const { passwordHash } = await row(ADMIN);
    expect(await verifyPassword("taken-over-pw", passwordHash!)).toBe(false);
    expect(await verifyPassword(ORIGINAL_PW, passwordHash!)).toBe(true);
  });

  it("can't take over someone who can do more than they can", async () => {
    actor = ACTORS.lead; // PEER holds the editor preset, far past the lead's three
    const res = await adminSetPassword({ userId: PEER, password: "taken-over-pw" });
    expect(res).toEqual({
      ok: false,
      error: "You can't set the password of someone with access you don't have.",
    });
    expect(await verifyPassword(ORIGINAL_PW, (await row(PEER)).passwordHash!)).toBe(true);
  });

  it("a restricted holder can't take over someone with brands they lack", async () => {
    actor = ACTORS.rlead;
    for (const target of [BONLY, SPLIT]) {
      const res = await adminSetPassword({ userId: target, password: "taken-over-pw" });
      expect(res).toEqual({
        ok: false,
        error: "You can't set the password of someone with access you don't have.",
      });
      expect(await verifyPassword(ORIGINAL_PW, (await row(target)).passwordHash!)).toBe(true);
    }
  });

  it("can set the password of someone whose access is within theirs", async () => {
    actor = ACTORS.rlead;
    expect(await adminSetPassword({ userId: JUNIOR, password: "fresh-password" })).toEqual({ ok: true });
    expect(await verifyPassword("fresh-password", (await row(JUNIOR)).passwordHash!)).toBe(true);
  });

  it("an admin still can set another admin's password", async () => {
    expect(await adminSetPassword({ userId: ADMIN2, password: "fresh-password" })).toEqual({ ok: true });
    expect(await verifyPassword("fresh-password", (await row(ADMIN2)).passwordHash!)).toBe(true);
  });
});

// ─── photo ───────────────────────────────────────────────────────────────

describe("photo — below admin", () => {
  it("can't remove an admin's photo", async () => {
    actor = ACTORS.lead;
    const res = await removeUserAvatar({ userId: ADMIN });
    expect(res).toEqual({ ok: false, error: "Only an admin can change an admin's photo." });
    expect((await row(ADMIN)).avatarUrl).toBe(PHOTO);
  });

  it("can't upload an admin's photo — refused before anything is stored", async () => {
    actor = ACTORS.lead;
    const form = new FormData();
    form.set("userId", ADMIN);
    // Not even a real image: the refusal must come before the bytes are read.
    form.set("file", new File([new Uint8Array([0, 1, 2, 3])], "x.webp", { type: "image/webp" }));
    const res = await avatarRoute(
      new Request("http://localhost/api/uploads/avatar", { method: "POST", body: form }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only an admin can change an admin's photo." });
    expect((await row(ADMIN)).avatarUrl).toBe(PHOTO);
  });

  it("can remove a non-admin's photo", async () => {
    await db.update(users).set({ avatarUrl: PHOTO }).where(eq(users.id, PEER));
    actor = ACTORS.lead;
    expect(await removeUserAvatar({ userId: PEER })).toEqual({ ok: true });
    expect((await row(PEER)).avatarUrl).toBeNull();
  });

  it("an admin still can remove another admin's photo", async () => {
    actor = { ...ACTORS.admin, id: ADMIN2, email: "admin2@test.local" };
    expect(await removeUserAvatar({ userId: ADMIN })).toEqual({ ok: true });
    expect((await row(ADMIN)).avatarUrl).toBeNull();
  });
});
