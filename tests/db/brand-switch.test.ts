import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * Brand switching through the REAL membership choke point (lib/tenant.ts):
 * only `@/lib/auth` (who is signed in) and `next/headers` (the cookie jar) are
 * faked. A restricted (`all_accounts = false`) user who is a member of A only
 * must not be able to switch to B, and a forged or stale `ccms_account`
 * cookie naming B must resolve to A — so every query downstream of
 * `getActiveAccountId()` stays inside the user's brands.
 */
const RESTRICTED = "11111111-1111-1111-1111-1111111111c1";

const jar = new Map<string, string>();
const reqHeaders = new Map<string, string>();
const setCookie = vi.fn((c: { name: string; value: string }) => void jar.set(c.name, c.value));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: setCookie,
  })),
  headers: vi.fn(async () => ({ get: (name: string) => reqHeaders.get(name) ?? null })),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  loadUserById: vi.fn(),
  can: vi.fn(() => true),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { eq } from "drizzle-orm";
import { auth, requireAuth, requirePermission, type SessionUser } from "@/lib/auth";
import { accounts, storeOrderFields, userAccounts, users } from "@/db/schema";
import { ACCOUNT_COOKIE, BRAND_REFUSED, getActiveAccountId, listAccounts } from "@/lib/tenant";
import { BRAND_HEADER, LAST_BRAND_COOKIE } from "@/lib/brand-path";
import { createAccount, setActiveAccount } from "@/app/actions/account";
import { CORE_FIELDS, SYSTEM_REQUIRED_FIELDS } from "@/store/fields";
import { USER, resetAndSeed } from "./fixtures";

const signIn = (u: SessionUser) => {
  vi.mocked(auth).mockResolvedValue(u);
  vi.mocked(requireAuth).mockResolvedValue(u);
  vi.mocked(requirePermission).mockResolvedValue(u);
};
const session = (id: string, over: Partial<SessionUser>): SessionUser => ({
  id, email: `${id}@test.local`, name: "Tester", role: "editor",
  permissions: null, allAccounts: true, avatarUrl: null, ...over,
});

beforeEach(async () => {
  await resetAndSeed();
  jar.clear();
  reqHeaders.clear();
  setCookie.mockClear();
  await db.insert(users).values({
    id: RESTRICTED, email: "restricted@test.local", name: "Restricted", role: "editor", allAccounts: false,
  });
  await db.insert(userAccounts).values({ userId: RESTRICTED, accountId: ACCOUNT_A });
});

describe("a restricted member of brand A", () => {
  beforeEach(() => signIn(session(RESTRICTED, { allAccounts: false })));

  it("lists only brand A", async () => {
    expect((await listAccounts()).map((a) => a.id)).toEqual([ACCOUNT_A]);
  });

  it("cannot switch to brand B — refused, and no cookie is written", async () => {
    expect(await setActiveAccount({ accountId: ACCOUNT_B })).toEqual({ ok: false, error: "Unknown brand" });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("can switch to brand A — an httpOnly cookie naming it", async () => {
    expect(await setActiveAccount({ accountId: ACCOUNT_A })).toEqual({ ok: true });
    expect(setCookie).toHaveBeenCalledWith(
      expect.objectContaining({ name: ACCOUNT_COOKIE, value: ACCOUNT_A, httpOnly: true, sameSite: "lax" }),
    );
  });

  it("a forged cookie naming B resolves to A, never B", async () => {
    jar.set(ACCOUNT_COOKIE, ACCOUNT_B);
    expect(await getActiveAccountId()).toBe(ACCOUNT_A);
  });

  it("stripped of every brand, the active brand throws instead of guessing", async () => {
    await db.delete(userAccounts);
    jar.set(ACCOUNT_COOKIE, ACCOUNT_A);
    await expect(getActiveAccountId()).rejects.toThrow("NO_BRAND_ACCESS");
    expect(await setActiveAccount({ accountId: ACCOUNT_A })).toEqual({ ok: false, error: "Unknown brand" });
  });
});

describe("an admin", () => {
  beforeEach(() => signIn(session(USER, { role: "admin", allAccounts: false })));

  it("sees and may switch to every brand, whatever the all_accounts flag says", async () => {
    expect((await listAccounts()).map((a) => a.id).sort()).toEqual([ACCOUNT_A, ACCOUNT_B].sort());
    expect(await setActiveAccount({ accountId: ACCOUNT_B })).toEqual({ ok: true });
    jar.set(ACCOUNT_COOKIE, ACCOUNT_B);
    expect(await getActiveAccountId()).toBe(ACCOUNT_B);
  });

  it("an unknown or malformed brand id is refused", async () => {
    expect(await setActiveAccount({ accountId: "cccccccc-cccc-cccc-cccc-cccccccccccc" })).toEqual({
      ok: false,
      error: "Unknown brand",
    });
    expect(await setActiveAccount({ accountId: "not-a-uuid" })).toEqual({ ok: false, error: "Invalid account" });
    expect(setCookie).not.toHaveBeenCalled();
  });
});

describe("creating a brand (onboarding a new brand — mesbah-style bugs live here)", () => {
  it("a restricted creator becomes a member of it in the same write, and can switch to it", async () => {
    signIn(session(RESTRICTED, { allAccounts: false, permissions: ["config.brands"] }));
    const res = await createAccount({ name: "zz-a06 New Brand" });
    expect(res.ok).toBe(true);

    expect((await listAccounts()).map((a) => a.id).sort()).toEqual([ACCOUNT_A, res.id!].sort());
    expect(await setActiveAccount({ accountId: res.id! })).toEqual({ ok: true });
  });

  it("starts with every core and system-required Store field, and a unique slug", async () => {
    signIn(session(USER, { role: "admin" }));
    const first = await createAccount({ name: "Account A" }); // the fixtures already hold slug account-a
    const fields = await db
      .select({ key: storeOrderFields.key, required: storeOrderFields.required })
      .from(storeOrderFields)
      .where(eq(storeOrderFields.accountId, first.id!));
    expect(fields.map((f) => f.key).sort()).toEqual(
      [...CORE_FIELDS, ...SYSTEM_REQUIRED_FIELDS].map((f) => f.key).sort(),
    );
    expect(fields.every((f) => f.required)).toBe(true);
    const [row] = await db.select({ slug: accounts.slug }).from(accounts).where(eq(accounts.id, first.id!));
    expect(row!.slug).toBe("account-a-2");
    // An admin needs no membership row — they already see every brand.
    expect(await db.select().from(userAccounts).where(eq(userAccounts.accountId, first.id!))).toEqual([]);
  });
});

describe("the brand in the URL (2026-11)", () => {
  it("the URL's brand wins over every cookie", async () => {
    signIn(session(USER, { role: "admin" }));
    jar.set(ACCOUNT_COOKIE, ACCOUNT_A);
    jar.set(LAST_BRAND_COOKIE, "account-a");
    reqHeaders.set(BRAND_HEADER, "account-b");
    expect(await getActiveAccountId()).toBe(ACCOUNT_B);
  });

  it("a brand the user can't open is REFUSED — never swapped for one they can", async () => {
    signIn(session(RESTRICTED, { allAccounts: false }));
    reqHeaders.set(BRAND_HEADER, "account-b");
    await expect(getActiveAccountId()).rejects.toThrow(BRAND_REFUSED);
  });

  it("a brand that doesn't exist reads the same", async () => {
    signIn(session(USER, { role: "admin" }));
    reqHeaders.set(BRAND_HEADER, "no-such-brand");
    await expect(getActiveAccountId()).rejects.toThrow(BRAND_REFUSED);
  });

  it("no brand in the URL (or `_`): the browser's last brand, then the old id cookie", async () => {
    signIn(session(USER, { role: "admin" }));
    reqHeaders.set(BRAND_HEADER, "_");
    jar.set(LAST_BRAND_COOKIE, "account-b");
    jar.set(ACCOUNT_COOKIE, ACCOUNT_A);
    expect(await getActiveAccountId()).toBe(ACCOUNT_B);
  });

  it("a restricted user's last-brand cookie naming a forbidden brand falls back, never through", async () => {
    signIn(session(RESTRICTED, { allAccounts: false }));
    jar.set(LAST_BRAND_COOKIE, "account-b");
    expect(await getActiveAccountId()).toBe(ACCOUNT_A);
  });
});

describe("a new brand's slug is a URL segment", () => {
  it("never a page name", async () => {
    signIn(session(USER, { role: "admin" }));
    const res = await createAccount({ name: "Store" });
    expect(res.ok).toBe(true);
    const [row] = await db.select({ slug: accounts.slug }).from(accounts).where(eq(accounts.id, res.id!));
    expect(row!.slug).toBe("store-2");
  });
});
