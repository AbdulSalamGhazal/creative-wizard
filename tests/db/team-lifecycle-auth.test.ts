import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the lifecycle stamps DO at the door (D4, 2026-11-06), through the REAL
 * `signIn` and the REAL `auth()` — only the cookie jar and request headers
 * are faked, as in sessions.test.ts. A deactivated person is told so (only
 * after the right password), their existing cookie is dead, and reactivation
 * lets them straight back in; a removed person's email reads like an unknown
 * one. And every successful sign-in stamps "last sign-in".
 */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (opts: { name: string; value: string }) => void jar.set(opts.name, opts.value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

process.env.AUTH_SECRET ||= "db-test-secret-at-least-16-chars";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth-password";
import { auth, loadUserById } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { signIn } from "@/app/actions/session";
import { DEACTIVATED_SIGNIN_MESSAGE } from "@/lib/team-lifecycle";
import { resetAndSeed } from "./fixtures";

const EMAIL = "member@test.local";
const PW = "member-password-1";
let MEMBER = "";

function form(email: string, password: string) {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

async function whoIs(cookie: string | undefined) {
  jar.clear();
  if (cookie) jar.set(SESSION_COOKIE, cookie);
  return (await auth())?.id ?? null;
}

async function member() {
  const [r] = await db
    .select({ lastSignInAt: users.lastSignInAt })
    .from(users)
    .where(eq(users.id, MEMBER));
  return r!;
}

beforeEach(async () => {
  await resetAndSeed();
  jar.clear();
  const [m] = await db
    .insert(users)
    .values({ email: EMAIL, name: "Member", role: "viewer", passwordHash: await hashPassword(PW) })
    .returning({ id: users.id });
  MEMBER = m!.id;
});

describe("sign-in stamps last_sign_in_at", () => {
  it("null before, set after", async () => {
    expect((await member()).lastSignInAt).toBeNull();
    expect(await signIn(form(EMAIL, PW))).toMatchObject({ ok: true });
    expect((await member()).lastSignInAt).not.toBeNull();
  });
});

describe("a deactivated member", () => {
  it("is told so — but only with the right password — and their open session is dead", async () => {
    expect(await signIn(form(EMAIL, PW))).toMatchObject({ ok: true });
    const cookie = jar.get(SESSION_COOKIE)!;
    expect(await whoIs(cookie)).toBe(MEMBER);

    await db.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, MEMBER));

    // The old cookie no longer resolves — nor does a token acting as them.
    expect(await whoIs(cookie)).toBeNull();
    expect(await loadUserById(MEMBER)).toBeNull();

    // Wrong password: the generic sentence, nothing learned.
    jar.clear();
    expect(await signIn(form(EMAIL, "nope-nope-nope"))).toEqual({ ok: false, error: "Wrong email or password." });
    // Right password: the reason, and no cookie.
    expect(await signIn(form(EMAIL, PW))).toEqual({ ok: false, error: DEACTIVATED_SIGNIN_MESSAGE });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    const failures = await db
      .select({ meta: auditEvents.meta })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "auth.signin_failed"), eq(auditEvents.entityLabel, EMAIL)));
    expect(failures.map((f) => (f.meta as { reason: string }).reason).sort()).toEqual([
      "bad_password",
      "deactivated",
    ]);

    // Reactivated: straight back in.
    await db.update(users).set({ deactivatedAt: null }).where(eq(users.id, MEMBER));
    expect(await signIn(form(EMAIL, PW))).toMatchObject({ ok: true });
  });
});

describe("a removed member", () => {
  it("reads like an unknown email, and their session is gone", async () => {
    expect(await signIn(form(EMAIL, PW))).toMatchObject({ ok: true });
    const cookie = jar.get(SESSION_COOKIE)!;
    await db
      .update(users)
      .set({ removedAt: new Date(), passwordHash: null })
      .where(eq(users.id, MEMBER));
    expect(await whoIs(cookie)).toBeNull();
    jar.clear();
    expect(await signIn(form(EMAIL, PW))).toEqual({ ok: false, error: "Wrong email or password." });
  });
});
