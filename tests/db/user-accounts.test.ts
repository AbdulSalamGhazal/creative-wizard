import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { db } from "@/lib/db";
import { accounts, userAccounts, users } from "@/db/schema";
import { allowedAccountIds } from "@/lib/account-access";
import { resetAndSeed } from "./fixtures";

// Brand membership at the DB layer: the allowed-set query (users.all_accounts +
// user_accounts rows) and the FK cascade that keeps memberships clean.

const RESTRICTED = "99999999-9999-9999-9999-999999999901";
const OPENUSER = "99999999-9999-9999-9999-999999999902";

/** The DB half of `allowedAccounts()`: every brand (ordered) + this user's rows. */
async function allowedFor(userId: string) {
  const [[user], all] = await Promise.all([
    db
      .select({ role: users.role, allAccounts: users.allAccounts })
      .from(users)
      .where(eq(users.id, userId)),
    db
      .select({ id: accounts.id })
      .from(accounts)
      .orderBy(asc(accounts.createdAt)),
  ]);
  const memberAccountIds = (
    await db
      .select({ accountId: userAccounts.accountId })
      .from(userAccounts)
      .where(eq(userAccounts.userId, userId))
  ).map((r) => r.accountId);
  return allowedAccountIds({
    isAdmin: user!.role === "admin",
    allAccounts: user!.allAccounts,
    allAccountIds: all.map((a) => a.id),
    memberAccountIds,
  });
}

beforeAll(async () => {
  await resetAndSeed(); // seeds ACCOUNT_A, ACCOUNT_B (A older) + an admin user
  await db.insert(users).values([
    {
      id: RESTRICTED,
      email: "restricted@test.local",
      name: "Restricted",
      role: "editor",
      allAccounts: false,
    },
    {
      id: OPENUSER,
      email: "open@test.local",
      name: "Open",
      role: "editor",
      allAccounts: true,
    },
  ]);
  await db
    .insert(userAccounts)
    .values({ userId: RESTRICTED, accountId: ACCOUNT_A });
});
beforeEach(() => vi.clearAllMocks());

describe("brand membership — allowed-set query", () => {
  it("a restricted user resolves to ONLY their membership brands", async () => {
    expect(await allowedFor(RESTRICTED)).toEqual([ACCOUNT_A]);
  });

  it("an all_accounts (non-admin) user resolves to every brand", async () => {
    // Fixtures seed A before B, so display order is [A, B].
    expect(await allowedFor(OPENUSER)).toEqual([ACCOUNT_A, ACCOUNT_B]);
  });
});

describe("brand membership — FK cascade", () => {
  it("deleting an account removes its membership rows", async () => {
    // A throwaway brand with no tenant data (so no RESTRICT from other FKs).
    const THROWAWAY = "99999999-9999-9999-9999-9999999900aa";
    await db.insert(accounts).values({
      id: THROWAWAY,
      name: "Throwaway",
      slug: "throwaway-cascade",
      statusWindowHours: 24,
    });
    await db
      .insert(userAccounts)
      .values({ userId: RESTRICTED, accountId: THROWAWAY });

    const before = await db
      .select({ accountId: userAccounts.accountId })
      .from(userAccounts)
      .where(eq(userAccounts.userId, RESTRICTED));
    expect(before.map((r) => r.accountId).sort()).toEqual(
      [ACCOUNT_A, THROWAWAY].sort(),
    );

    await db.delete(accounts).where(eq(accounts.id, THROWAWAY));

    const after = await db
      .select({ accountId: userAccounts.accountId })
      .from(userAccounts)
      .where(eq(userAccounts.userId, RESTRICTED));
    // The THROWAWAY membership is gone; the ACCOUNT_A one survives.
    expect(after.map((r) => r.accountId)).toEqual([ACCOUNT_A]);
  });

  it("deleting a user removes their membership rows", async () => {
    const before = await db
      .select({ accountId: userAccounts.accountId })
      .from(userAccounts)
      .where(eq(userAccounts.userId, RESTRICTED));
    expect(before.length).toBeGreaterThan(0);

    await db.delete(users).where(eq(users.id, RESTRICTED));

    const after = await db
      .select({ accountId: userAccounts.accountId })
      .from(userAccounts)
      .where(eq(userAccounts.userId, RESTRICTED));
    expect(after).toHaveLength(0);
  });
});
