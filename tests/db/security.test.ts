import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, gt, sql } from "drizzle-orm";
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
import { auditEvents, userAccounts, users } from "@/db/schema";
import { allowedAccountsForUser } from "@/lib/tenant";
import { AUDIT_ACTIONS } from "@/lib/audit";
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

/**
 * Sign-in throttling counts this email's FAILED sign-in audit rows inside a
 * sliding window — no new table, and the same generic message either way so a
 * throttled attempt is indistinguishable from a wrong password.
 */
describe("sign-in throttle", () => {
  const WINDOW_MINUTES = 15;
  const MAX = 5;

  /** The action's counter, verbatim. */
  async function recentFailures(email: string) {
    const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, AUDIT_ACTIONS.AUTH_SIGNIN_FAILED),
          eq(auditEvents.entityLabel, email),
          gt(auditEvents.at, since),
        ),
      );
    return Number(row?.n ?? 0);
  }

  const logFailure = (email: string, at?: Date) =>
    db.insert(auditEvents).values({
      accountId: ACCOUNT_A,
      action: AUDIT_ACTIONS.AUTH_SIGNIN_FAILED,
      entityType: "auth",
      entityLabel: email,
      ...(at ? { at } : {}),
    });

  it("five failures throttle the sixth attempt", async () => {
    const email = "victim@test.local";
    for (let i = 0; i < MAX - 1; i++) await logFailure(email);
    expect(await recentFailures(email)).toBe(4);
    expect((await recentFailures(email)) >= MAX).toBe(false); // 5th still tried

    await logFailure(email);
    expect(await recentFailures(email)).toBe(5);
    expect((await recentFailures(email)) >= MAX).toBe(true); // 6th throttled
  });

  it("other emails are unaffected", async () => {
    const email = "victim@test.local";
    for (let i = 0; i < MAX; i++) await logFailure(email);
    expect((await recentFailures(email)) >= MAX).toBe(true);
    expect(await recentFailures("bystander@test.local")).toBe(0);
  });

  it("the window slides — failures older than it stop counting", async () => {
    const email = "victim@test.local";
    const old = new Date(Date.now() - (WINDOW_MINUTES + 5) * 60 * 1000);
    for (let i = 0; i < MAX; i++) await logFailure(email, old);
    // All outside the window → no throttle, without any explicit reset.
    expect(await recentFailures(email)).toBe(0);
  });
});
