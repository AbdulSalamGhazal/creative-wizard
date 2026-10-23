import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    ACCOUNT_COOKIE: "ccms_account",
    getActiveAccountId: vi.fn(async () => ACCOUNT_A),
    getActiveAccount: vi.fn(),
    getActiveStatusWindowHours: vi.fn(async () => 24),
  };
});

import { db } from "@/lib/db";
import { userAccounts, users } from "@/db/schema";
import { allowedAccountsForUser } from "@/lib/tenant";
import { resetAndSeed } from "./fixtures";

const RESTRICTED = "aaaaaaaa-0000-0000-0000-0000000000a1";

beforeEach(async () => {
  await resetAndSeed();
});

/**
 * The ads commit route pins its writes to the account the validation SESSION
 * was created under. That id is a bearer secret, and nothing downstream
 * re-checked WHO is committing — so the route re-verifies membership.
 */
describe("upload commit — brand membership re-check", () => {
  it("a restricted user is not allowed into a brand they don't belong to", async () => {
    await db.insert(users).values({
      id: RESTRICTED,
      email: "restricted@test.local",
      name: "Restricted",
      role: "editor",
      allAccounts: false,
    });
    await db.insert(userAccounts).values({ userId: RESTRICTED, accountId: ACCOUNT_A });

    const me = { id: RESTRICTED, role: "editor" as const, allAccounts: false };
    const allowed = await allowedAccountsForUser(me);
    const ids = allowed.map((a) => a.id);

    // The check the route performs.
    expect(ids.includes(ACCOUNT_A)).toBe(true); // own brand → commit proceeds
    expect(ids.includes(ACCOUNT_B)).toBe(false); // someone else's → 403
  });

  it("an all-accounts user passes for every brand", async () => {
    const me = { id: RESTRICTED, role: "editor" as const, allAccounts: true };
    const ids = (await allowedAccountsForUser(me)).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([ACCOUNT_A, ACCOUNT_B]));
  });
});

// The sign-in throttle is pinned in tests/db/signin.test.ts, through the real
// `signIn` action. (A copy of its counter used to live here; it passed while
// `signIn` had no throttle at all — audit B-02.)
