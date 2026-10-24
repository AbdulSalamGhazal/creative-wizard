import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * Sign-in failures are audited and THROTTLED (D2, audit B-02, 2026-10-23),
 * driven through the REAL `signIn` action with the REAL `lib/tenant` and
 * `lib/auth` — only the cookie jar and the request headers are faked, and the
 * jar starts EMPTY, because a visitor failing to sign in has no session.
 * Since F1 (2026-10-24) the throttle counts per (email, network address), the
 * address read from `x-forwarded-for` the way Vercel sends it.
 *
 * Before the fix both halves were missing at once: `logAudit` resolved the
 * active brand, which for a visitor with no session throws NO_BRAND_ACCESS,
 * and the audit swallowed it — so no `auth.signin_failed` row was ever
 * written — and `signIn` never counted failures anyway (the old test counted
 * a COPY of the query against rows it inserted itself).
 */
const jar = new Map<string, string>();
/** The request headers the next `signIn` sees — the visitor's address. */
let requestHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  headers: async () => new Headers(requestHeaders),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (opts: { name: string; value: string }) => void jar.set(opts.name, opts.value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

process.env.AUTH_SECRET ||= "db-test-secret-at-least-16-chars";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth-password";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { signIn } from "@/app/actions/session";
import { signInFailuresQuery } from "@/db/queries/auth";
import { resetAndSeed } from "./fixtures";

const EMAIL = "victim@test.local";
const PW = "correct-horse-battery";
const THROTTLED = { ok: false, error: "Too many attempts — try again in 15 minutes." };
const HOME = "203.0.113.10"; // the person's own network
const STRANGER = "198.51.100.66"; // someone elsewhere trying their email

/** Sign in as if from `ip` (null = the host reported no address). */
async function signInFrom(ip: string | null, email: string, password: string) {
  requestHeaders = ip ? { "x-forwarded-for": `${ip}, 10.0.0.1` } : {};
  return signIn(form(email, password));
}

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
  requestHeaders = { "x-forwarded-for": HOME };
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

describe("sign-in throttle — 5 failures per email per address per 15 minutes", () => {
  it("after five failures even the right password waits, and says so", async () => {
    for (let i = 0; i < 5; i++) await signIn(form(EMAIL, `wrong-${i}`));
    jar.clear();
    const res = await signIn(form(EMAIL, PW));
    expect(res).toEqual(THROTTLED);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    const throttled = await rows(AUDIT_ACTIONS.AUTH_SIGNIN_THROTTLED);
    expect(throttled).toHaveLength(1);
    expect(throttled[0]!.accountId).toBe(ACCOUNT_A);
    expect(throttled[0]!.meta).toMatchObject({ ip: HOME });
    // A throttled attempt is not a failure: it does not extend the wait.
    expect(await rows(AUDIT_ACTIONS.AUTH_SIGNIN_FAILED)).toHaveLength(5);
  });

  it("the fifth failure itself still reads as a wrong password", async () => {
    for (let i = 0; i < 4; i++) await signIn(form(EMAIL, `wrong-${i}`));
    expect(await signIn(form(EMAIL, "wrong-4"))).toEqual({
      ok: false,
      error: "Wrong email or password.",
    });
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

describe("the throttle counts per network address (F1)", () => {
  it("a stranger's five failures don't lock the person out from their own network", async () => {
    for (let i = 0; i < 5; i++) await signInFrom(STRANGER, EMAIL, `guess-${i}`);
    // The stranger is throttled…
    expect(await signInFrom(STRANGER, EMAIL, PW)).toEqual(THROTTLED);
    // …the person, from their own address, signs straight in.
    jar.clear();
    expect(await signInFrom(HOME, EMAIL, PW)).toEqual({ ok: true });
    expect(jar.has(SESSION_COOKIE)).toBe(true);
  });

  it("each failure records the address it came from", async () => {
    await signInFrom(STRANGER, EMAIL, "guess");
    const [failed] = await rows(AUDIT_ACTIONS.AUTH_SIGNIN_FAILED);
    expect(failed!.meta).toMatchObject({ ip: STRANGER, reason: "bad_password" });
  });

  it("the address is the FIRST forwarded hop — proxies behind it don't split the count", async () => {
    for (let i = 0; i < 5; i++) {
      requestHeaders = { "x-forwarded-for": `${STRANGER}, 10.0.0.${i + 1}` };
      await signIn(form(EMAIL, `guess-${i}`));
    }
    requestHeaders = { "x-forwarded-for": `${STRANGER}, 10.9.9.9` };
    expect(await signIn(form(EMAIL, PW))).toEqual(THROTTLED);
  });

  it("x-real-ip is read when x-forwarded-for is absent", async () => {
    for (let i = 0; i < 5; i++) {
      requestHeaders = { "x-real-ip": STRANGER };
      await signIn(form(EMAIL, `guess-${i}`));
    }
    requestHeaders = { "x-real-ip": STRANGER };
    expect(await signIn(form(EMAIL, PW))).toEqual(THROTTLED);
    requestHeaders = { "x-real-ip": HOME };
    expect(await signIn(form(EMAIL, PW))).toEqual({ ok: true });
  });

  it("an unknown email is throttled the same way, with the same message", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await signInFrom(STRANGER, "nobody@test.local", `guess-${i}`)).toEqual({
        ok: false,
        error: "Wrong email or password.",
      });
    }
    expect(await signInFrom(STRANGER, "nobody@test.local", "guess-5")).toEqual(THROTTLED);
  });

  it("with no address, the count falls back to the email across every address", async () => {
    for (let i = 0; i < 5; i++) await signInFrom(STRANGER, EMAIL, `guess-${i}`);
    // Stripping the address can't buy a fresh count…
    expect(await signInFrom(null, EMAIL, PW)).toEqual(THROTTLED);
    // …and a no-address failure is counted by email alone.
    await resetAndSeed();
    await db.insert(users).values({
      email: EMAIL,
      name: "Victim",
      role: "admin",
      passwordHash: await hashPassword(PW),
    });
    for (let i = 0; i < 5; i++) await signInFrom(null, EMAIL, `guess-${i}`);
    expect(await signInFrom(null, EMAIL, PW)).toEqual(THROTTLED);
    const [failed] = await rows(AUDIT_ACTIONS.AUTH_SIGNIN_FAILED);
    expect(failed!.meta).not.toHaveProperty("ip");
  });

  it("the per-address count can use its index (bounded on every attempt)", async () => {
    const query = signInFailuresQuery(EMAIL, STRANGER, new Date()).toSQL();
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      return tx.execute(sql.raw(`EXPLAIN (FORMAT JSON) ${inline(query)}`));
    });
    expect(JSON.stringify(plan)).toContain("audit_signin_failed_ip_idx");
  });
});

/** Inline a drizzle `toSQL()` result's params for EXPLAIN (test-only; trusted values). */
function inline({ sql: text, params }: { sql: string; params: unknown[] }): string {
  return text.replace(/\$(\d+)/g, (_, n: string) => {
    const v = params[Number(n) - 1];
    if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
    return typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  });
}
