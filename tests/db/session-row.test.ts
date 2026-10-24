import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ACCOUNT_A } from "./config";

/**
 * W2-5 (2026-10): the `users` row is read ONCE per request. `auth()` used to
 * read it, then each preference getter (range, Excluded, toast scope) read
 * the same row again for one column — 2–4 reads per page. As in
 * status-cache.test.ts, React's request `cache()` is stood in for by a
 * call-once memo (vitest has no request scope), so what's pinned is the
 * WIRING: every getter answers from the row `auth()` already loaded.
 */
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      let memo: R | undefined;
      let called = false;
      return (...args: A): R => {
        if (!called) {
          called = true;
          memo = fn(...args);
        }
        return memo as R;
      };
    },
  };
});
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures
vi.mock("@/lib/auth-cookie", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-cookie")>()),
  readSession: vi.fn(async () => ({ userId: USER, issuedAt: Date.now() })),
}));

import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  getPreferredRange,
  getToastScope,
  resolveIncludeExcluded,
} from "@/db/queries/user-prefs";
import { resetAndSeed } from "./fixtures";

beforeAll(async () => {
  await resetAndSeed();
  await db
    .update(users)
    .set({ preferredDateRange: "custom:2026-01-01..2026-01-31", includeExcluded: true, toastScope: "all" })
    .where(eq(users.id, USER));
});

describe("the signed-in user's row, once per request", () => {
  it("auth() reads it; the three preference getters add NO query and read the stored values", async () => {
    const spy = vi.spyOn(db, "select");
    const me = await auth();
    expect(me?.id).toBe(USER);
    const afterAuth = spy.mock.calls.length;
    expect(afterAuth).toBe(1);

    expect(await getPreferredRange()).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(await resolveIncludeExcluded(undefined)).toBe(true);
    expect(await getToastScope()).toBe("all");
    expect(spy.mock.calls.length).toBe(afterAuth);
    spy.mockRestore();
  });

  it("the preferences never reach SessionUser (it is handed to client components)", async () => {
    const me = await auth();
    expect(Object.keys(me ?? {})).not.toEqual(
      expect.arrayContaining(["preferredDateRange", "includeExcluded", "toastScope"]),
    );
  });
});
