import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ending sessions (D3, audit B-19, 2026-10-23). The session cookie is
 * stateless — `<userId>.<issuedAtMs>.<hmac>` — so before this, signing out
 * only deleted THIS browser's cookie, and a password change or an admin reset
 * left every other cookie valid for its full 30 days. Now each of the three
 * stamps `users.sessions_revoked_at`, and `auth()` signs out any cookie issued
 * before it. Since F2 (2026-10-24, user decision) plain "Sign out" ends only
 * THIS device; "Sign out everywhere" is the stamp.
 *
 * Driven through the REAL actions and the REAL `auth()`; only the cookie jar
 * is faked. "Two devices" = two cookies for the same person, swapped into the
 * jar the way two browsers would each send their own.
 */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers(), // no address: the throttle keys by email
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (opts: { name: string; value: string }) => void jar.set(opts.name, opts.value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

process.env.AUTH_SECRET ||= "db-test-secret-at-least-16-chars";

import { and, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth-password";
import { auth } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import {
  changePassword,
  signIn,
  signOut,
  signOutEverywhere,
} from "@/app/actions/session";
import { adminSetPassword } from "@/app/actions/user";
import { resetAndSeed, USER as ADMIN } from "./fixtures";

const EMAIL = "member@test.local";
const PW = "member-password-1";
let MEMBER = "";

function form(email: string, password: string) {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

/** Sign in on a fresh "device" and return its cookie. */
async function deviceCookie(email: string, password: string): Promise<string> {
  jar.clear();
  // Distinct issued-at per device, the way two real sign-ins are.
  await new Promise((r) => setTimeout(r, 5));
  const res = await signIn(form(email, password));
  expect(res).toEqual({ ok: true });
  return jar.get(SESSION_COOKIE)!;
}

/** The sign-out audit actions recorded for this person, oldest first. */
async function audited(userId: string): Promise<string[]> {
  const rows = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(and(eq(auditEvents.actorUserId, userId), like(auditEvents.action, "auth.signout%")))
    .orderBy(auditEvents.id);
  return rows.map((r) => r.action);
}

/** Who `auth()` says is signed in when this cookie is sent. */
async function whoIs(cookie: string | undefined) {
  jar.clear();
  if (cookie) jar.set(SESSION_COOKIE, cookie);
  return (await auth())?.id ?? null;
}

beforeEach(async () => {
  await resetAndSeed();
  const [m] = await db
    .insert(users)
    .values({ email: EMAIL, name: "Member", role: "viewer", passwordHash: await hashPassword(PW) })
    .returning({ id: users.id });
  MEMBER = m!.id;
  await db
    .update(users)
    .set({ passwordHash: await hashPassword("admin-password-1") })
    .where(eq(users.id, ADMIN));
});

describe("Sign out ends THIS device only (F2)", () => {
  it("the other device stays signed in, and nothing is stamped", async () => {
    const laptop = await deviceCookie(EMAIL, PW);
    const phone = await deviceCookie(EMAIL, PW);

    jar.clear();
    jar.set(SESSION_COOKIE, phone);
    await expect(signOut()).rejects.toThrow(); // redirect("/signin") throws by design
    expect(jar.has(SESSION_COOKIE)).toBe(false); // this device's cookie is gone

    expect(await whoIs(laptop)).toBe(MEMBER);
    const [row] = await db
      .select({ at: users.sessionsRevokedAt })
      .from(users)
      .where(eq(users.id, MEMBER));
    expect(row!.at).toBeNull();
    expect(await audited(MEMBER)).toEqual(["auth.signout"]);
  });
});

describe("Sign out everywhere ends every session (D3 → F2)", () => {
  it("signing out everywhere on one device signs the other out too", async () => {
    const laptop = await deviceCookie(EMAIL, PW);
    const phone = await deviceCookie(EMAIL, PW);
    expect(await whoIs(laptop)).toBe(MEMBER);
    expect(await whoIs(phone)).toBe(MEMBER);

    jar.clear();
    jar.set(SESSION_COOKIE, phone);
    await expect(signOutEverywhere()).rejects.toThrow();
    expect(jar.has(SESSION_COOKIE)).toBe(false);

    expect(await whoIs(laptop)).toBeNull();
    expect(await whoIs(phone)).toBeNull();
    expect(await audited(MEMBER)).toEqual(["auth.signout_everywhere"]);
  });

  it("signing in again afterwards works", async () => {
    const before = await deviceCookie(EMAIL, PW);
    jar.set(SESSION_COOKIE, before);
    await expect(signOutEverywhere()).rejects.toThrow();
    const after = await deviceCookie(EMAIL, PW);
    expect(await whoIs(after)).toBe(MEMBER);
  });
});

describe("a password change ends the OTHER sessions", () => {
  it("the device that changed it stays signed in; the other is signed out", async () => {
    const laptop = await deviceCookie(EMAIL, PW);
    const phone = await deviceCookie(EMAIL, PW);

    jar.clear();
    jar.set(SESSION_COOKIE, phone);
    const res = await changePassword({
      currentPassword: PW,
      newPassword: "member-password-2",
      confirmPassword: "member-password-2",
    });
    expect(res).toEqual({ ok: true });
    const phoneNow = jar.get(SESSION_COOKIE)!; // re-issued by the change

    expect(await whoIs(phoneNow)).toBe(MEMBER);
    expect(await whoIs(laptop)).toBeNull();
    expect(await whoIs(phone)).toBeNull(); // the pre-change cookie itself
  });
});

describe("an admin reset ends every session of that person", () => {
  it("the person is signed out everywhere; the admin is not", async () => {
    const memberCookie = await deviceCookie(EMAIL, PW);
    const adminCookie = await deviceCookie("harness@test.local", "admin-password-1");

    jar.clear();
    jar.set(SESSION_COOKIE, adminCookie);
    expect(await adminSetPassword({ userId: MEMBER, password: "reset-password-1" })).toEqual({ ok: true });

    expect(await whoIs(memberCookie)).toBeNull();
    expect(await whoIs(adminCookie)).toBe(ADMIN);
  });

  it("resetting your OWN password there keeps this device signed in", async () => {
    const adminCookie = await deviceCookie("harness@test.local", "admin-password-1");
    jar.clear();
    jar.set(SESSION_COOKIE, adminCookie);
    expect(await adminSetPassword({ userId: ADMIN, password: "admin-password-2" })).toEqual({ ok: true });
    const reissued = jar.get(SESSION_COOKIE)!;
    expect(await whoIs(reissued)).toBe(ADMIN);
    expect(await whoIs(adminCookie)).toBeNull();
  });
});

describe("nothing else signs anyone out", () => {
  it("a never-revoked person's old cookie still works", async () => {
    const cookie = await deviceCookie(EMAIL, PW);
    expect(await whoIs(cookie)).toBe(MEMBER);
    const [row] = await db
      .select({ at: users.sessionsRevokedAt })
      .from(users)
      .where(eq(users.id, MEMBER));
    expect(row!.at).toBeNull();
  });
});
