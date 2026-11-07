import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * A notification about a thread reaches only someone that thread's page lets
 * in (2026-11-07): a Price Structure version's replies, follow-ups and
 * reactions skip a brand member who holds none of the module's grants.
 * The REAL `can` — permissions come from the users' rows.
 */
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
}));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, userAccounts, users } from "@/db/schema";
import { createNotifications } from "@/db/queries/notifications";
import { resetAndSeed } from "./fixtures";

const WITH = "11111111-1111-1111-1111-1111111111c1";
const WITHOUT = "11111111-1111-1111-1111-1111111111c2";

beforeEach(async () => {
  await resetAndSeed();
  await db.insert(users).values([
    { id: WITH, email: "with@test.local", name: "With", role: "editor", permissions: ["price_structure.view"] },
    { id: WITHOUT, email: "without@test.local", name: "Without", role: "editor", permissions: ["creative.edit"] },
  ]);
  await db.insert(userAccounts).values([
    { userId: WITH, accountId: ACCOUNT_A },
    { userId: WITHOUT, accountId: ACCOUNT_A },
  ]);
});

const reply = (recipientUserId: string, entityType: string) => ({
  accountId: ACCOUNT_A,
  recipientUserId,
  category: "reply" as const,
  type: "comment.reply" as const,
  title: "Someone replied",
  entityType,
  entityId: "57cfe8ed-9f03-4912-83c4-0777e31150df",
});

describe("notifications follow the thread's page access", () => {
  it("a Price Structure thread notifies its members only", async () => {
    const n = await db.transaction((tx) =>
      createNotifications(tx, [reply(WITH, "ps_version"), reply(WITHOUT, "ps_version")]),
    );
    expect(n).toBe(1);
    const rows = await db.select().from(notifications).where(eq(notifications.accountId, ACCOUNT_A));
    expect(rows.map((r) => r.recipientUserId)).toEqual([WITH]);
  });

  it("any other thread is unaffected", async () => {
    const n = await db.transaction((tx) =>
      createNotifications(tx, [reply(WITH, "creative"), reply(WITHOUT, "creative")]),
    );
    expect(n).toBe(2);
  });
});
