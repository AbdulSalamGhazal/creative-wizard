import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * Sign-in failures are audited and THROTTLED (D2, audit B-02, 2026-10-23),
 * driven through the REAL `signIn` action with the REAL `lib/tenant` and
 * `lib/auth` — only the cookie jar is faked, and it starts EMPTY, because a
 * visitor failing to sign in has no session.
 *
 * Before the fix both halves were missing at once: `logAudit` resolved the
 * active brand, which for a visitor with no session throws NO_BRAND_ACCESS,
 * and the audit swallowed it — so no `auth.signin_failed` row was ever
 * written — and `signIn` never counted failures anyway (the old test counted
 * a COPY of the query against rows it inserted itself).
 */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
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
import { AUDIT_ACTIONS } from "@/lib/audit";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { signIn } from "@/app/actions/session";
import { resetAndSeed } from "./fixtures";

const EMAIL = "victim@test.local";
const PW = "correct-horse-battery";

function form(email: string, password: string) {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

async function rows(action: string, email = EMAIL) {
  return db
    .select({ accountId: auditEvents.accountId, meta: auditEvents.meta, at: auditEvents.at })
    .from(auditEvents)
    .where(and(eq(auditEvents.action, action), eq(auditEvents.entityLabel, email)));
}

beforeEach(async () => {
  await resetAndSeed(); // ACCOUNT_A is the oldest brand
  await db.insert(users).values({
    email: EMAIL,
    name: "Victim",
    role: "admin",
    passwordHash: await hashPassword(PW),
  });
  jar.clear();
});

describe("sign-in failures are recorded", () => {
  it("a wrong password writes auth.signin_failed, filed under the oldest brand", async () => {
    expect(await signIn(form(EMAIL, "wrong-password"))).toEqual({
      ok: false,
      error: "Wrong email or password.",
    });
    const failed = await rows(AUDIT_ACTIONS.AUTH_SIGNIN_FAILED);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.accountId).toBe(ACCOUNT_A);
    expect(failed[0]!.meta).toMatchObject({ reason: "bad_password" });
  });

  it("an unknown email is recorded too, under the same generic message", async () => {
    const res = await signIn(form("nobody@test.local", "whatever"));
    expect(res).toEqual({ ok: false, error: "Wrong email or password." });
    expect(await rows(AUDIT_ACTIONS.AUTH_SIGNIN_FAILED, "nobody@test.local")).toHaveLength(1);
  });
});

describe("sign-in throttle — 5 failures per email per 15 minutes", () => {
  it("after five failures even the right password waits, and nothing signs in", async () => {
    for (let i = 0; i < 5; i++) await signIn(form(EMAIL, `wrong-${i}`));
    jar.clear();
    const res = await signIn(form(EMAIL, PW));
    expect(res).toEqual({ ok: false, error: "Wrong email or password." });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    const throttled = await rows(AUDIT_ACTIONS.AUTH_SIGNIN_THROTTLED);
    expect(throttled).toHaveLength(1);
    expect(throttled[0]!.accountId).toBe(ACCOUNT_A);
    // A throttled attempt is not a failure: it does not extend the wait.
    expect(await rows(AUDIT_ACTIONS.AUTH_SIGNIN_FAILED)).toHaveLength(5);
  });

  it("four failures still let the right password in", async () => {
    for (let i = 0; i < 4; i++) await signIn(form(EMAIL, `wrong-${i}`));
    expect(await signIn(form(EMAIL, PW))).toEqual({ ok: true });
    expect(jar.has(SESSION_COOKIE)).toBe(true);
  });

  it("counts the email however it was typed", async () => {
    for (let i = 0; i < 5; i++) await signIn(form("Victim@Test.LOCAL", `wrong-${i}`));
    expect((await signIn(form(EMAIL, PW))).ok).toBe(false);
  });

  it("other emails are unaffected", async () => {
    await db.insert(users).values({
      email: "bystander@test.local",
      name: "Bystander",
      role: "viewer",
      passwordHash: await hashPassword(PW),
    });
    for (let i = 0; i < 5; i++) await signIn(form(EMAIL, `wrong-${i}`));
    expect(await signIn(form("bystander@test.local", PW))).toEqual({ ok: true });
  });

  it("the window slides — failures older than 15 minutes stop counting", async () => {
    for (let i = 0; i < 5; i++) await signIn(form(EMAIL, `wrong-${i}`));
    const old = new Date(Date.now() - 16 * 60 * 1000);
    await db
      .update(auditEvents)
      .set({ at: old })
      .where(eq(auditEvents.action, AUDIT_ACTIONS.AUTH_SIGNIN_FAILED));
    expect(await signIn(form(EMAIL, PW))).toEqual({ ok: true });
  });
});
