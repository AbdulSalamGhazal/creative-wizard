import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

const ADMIN = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures
const ALICE = "11111111-1111-1111-1111-1111111111a1";
const BOB = "11111111-1111-1111-1111-1111111111b1";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  listAllAccounts: vi.fn(async () => [
    { id: ACCOUNT_A, name: "Account A" },
    { id: ACCOUNT_B, name: "Account B" },
  ]),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

// Only the auth boundary is faked. Everything below it — the scoping, the
// transactions, the routing reads — runs for real.
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: ADMIN, role: "admin" })),
  requireAuth: vi.fn(async () => ({ id: ALICE, role: "editor" })),
  auth: vi.fn(async () => ({ id: ALICE, role: "editor" })),
  can: vi.fn(() => true),
}));

import { auth, requireAuth } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { notificationRoutes, notifications, users } from "@/db/schema";
import {
  brandMembers,
  createNotifications,
  listNotifications,
  notifyRoutes,
  recentNotifications,
  replaceEventRoutes,
  routeRecipients,
  unreadCount,
} from "@/db/queries/notifications";
import {
  archiveNotification,
  markAllRead,
  markNotificationRead,
  unarchiveNotification,
} from "@/app/actions/notifications";
import { updateUserBrands } from "@/app/actions/user";
import { resetAndSeed } from "./fixtures";

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);
const setUser = (id: string) => {
  const session = { id, role: "editor" as const };
  vi.mocked(auth).mockResolvedValue(session as never);
  vi.mocked(requireAuth).mockResolvedValue(session as never);
};

/** Write one notification straight to the table. */
async function seedNotification(opts: {
  accountId?: string;
  recipientUserId?: string;
  title?: string;
  body?: string | null;
  readAt?: Date | null;
  archivedAt?: Date | null;
}) {
  const [row] = await db
    .insert(notifications)
    .values({
      accountId: opts.accountId ?? ACCOUNT_A,
      recipientUserId: opts.recipientUserId ?? ALICE,
      category: "system",
      type: "upload.committed",
      title: opts.title ?? "Something happened",
      body: opts.body ?? null,
      readAt: opts.readAt ?? null,
      archivedAt: opts.archivedAt ?? null,
    })
    .returning({ id: notifications.id });
  return row!.id;
}

beforeEach(async () => {
  await resetAndSeed();
  await db.insert(users).values([
    { id: ALICE, email: "alice@test.local", name: "Alice", role: "editor" },
    { id: BOB, email: "bob@test.local", name: "Bob", role: "editor" },
  ]);
  setAccount(ACCOUNT_A);
  setUser(ALICE);
});

describe("routing — who gets told", () => {
  it("notifies exactly the routed recipients, minus the actor", async () => {
    await db.insert(notificationRoutes).values([
      { accountId: ACCOUNT_A, eventType: "upload.committed", userId: ALICE },
      { accountId: ACCOUNT_A, eventType: "upload.committed", userId: BOB },
      // A route in ANOTHER brand for the same event must not fire here.
      { accountId: ACCOUNT_B, eventType: "upload.committed", userId: ALICE },
      // A route for a DIFFERENT event must not fire either.
      { accountId: ACCOUNT_A, eventType: "budget.plan_saved", userId: BOB },
    ]);

    const written = await db.transaction((tx) =>
      notifyRoutes(tx, ACCOUNT_A, "upload.committed", {
        title: "Ads upload: 12 rows for TikTok",
        actorUserId: ALICE, // Alice did it, so Alice hears nothing
        entity: { type: "upload", id: "batch-1" },
      }),
    );

    expect(written).toBe(1);
    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recipientUserId).toBe(BOB);
    expect(rows[0]!.accountId).toBe(ACCOUNT_A);
    expect(rows[0]!.category).toBe("system");
    expect(rows[0]!.dedupeKey).toBeNull(); // phase-3 reservation, unused
  });

  it("is SILENT when nothing is routed — the deliberate default", async () => {
    const written = await db.transaction((tx) =>
      notifyRoutes(tx, ACCOUNT_A, "budget.plan_saved", {
        title: "September's budget plan was saved",
        actorUserId: BOB,
      }),
    );
    expect(written).toBe(0);
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("rolls the notification back with the write that caused it", async () => {
    await db.insert(notificationRoutes).values({
      accountId: ACCOUNT_A,
      eventType: "upload.rolled_back",
      userId: BOB,
    });

    await expect(
      db.transaction(async (tx) => {
        await notifyRoutes(tx, ACCOUNT_A, "upload.rolled_back", {
          title: "Upload rolled back",
          actorUserId: ALICE,
        });
        // The causing write fails AFTER the notification was queued.
        throw new Error("the real write failed");
      }),
    ).rejects.toThrow("the real write failed");

    // Nobody was told about something that never happened.
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("replaces an event's recipients atomically, and dedupes the input", async () => {
    await db.transaction((tx) =>
      replaceEventRoutes(tx, ACCOUNT_A, "budget.plan_saved", [ALICE, BOB, ALICE]),
    );
    let routes = await db
      .select()
      .from(notificationRoutes)
      .where(eq(notificationRoutes.eventType, "budget.plan_saved"));
    expect(routes).toHaveLength(2); // the duplicate ALICE collapsed

    await db.transaction((tx) =>
      replaceEventRoutes(tx, ACCOUNT_A, "budget.plan_saved", [BOB]),
    );
    routes = await db
      .select()
      .from(notificationRoutes)
      .where(eq(notificationRoutes.eventType, "budget.plan_saved"));
    expect(routes.map((r) => r.userId)).toEqual([BOB]);

    // Clearing the set is valid: the event then notifies nobody.
    await db.transaction((tx) =>
      replaceEventRoutes(tx, ACCOUNT_A, "budget.plan_saved", []),
    );
    expect(await routeRecipients()).toEqual({});
  });

  it("refuses a duplicate route row at the index", async () => {
    await db.insert(notificationRoutes).values({
      accountId: ACCOUNT_A,
      eventType: "upload.committed",
      userId: ALICE,
    });
    await expect(
      db.insert(notificationRoutes).values({
        accountId: ACCOUNT_A,
        eventType: "upload.committed",
        userId: ALICE,
      }),
    ).rejects.toThrow();
  });

  it("lists the brand's members: admins, all-brands users, and explicit members", async () => {
    const members = await brandMembers();
    const ids = members.map((m) => m.id);
    // The fixture admin plus both all-brands editors.
    expect(ids).toContain(ADMIN);
    expect(ids).toContain(ALICE);
    expect(ids).toContain(BOB);

    // A restricted user with no membership in A is not routable there.
    await db.update(users).set({ allAccounts: false }).where(eq(users.id, BOB));
    expect((await brandMembers()).map((m) => m.id)).not.toContain(BOB);
  });
});

describe("self-scoping — the security rule of this module", () => {
  it("never shows, marks or archives another user's notifications", async () => {
    const bobsRow = await seedNotification({ recipientUserId: BOB, title: "For Bob" });
    await seedNotification({ recipientUserId: ALICE, title: "For Alice" });

    // Alice is the session user.
    expect(await unreadCount()).toBe(1);
    expect((await recentNotifications()).map((r) => r.title)).toEqual(["For Alice"]);
    const list = await listNotifications({ tab: "all" });
    expect(list.rows.map((r) => r.title)).toEqual(["For Alice"]);

    // Acting on Bob's id does nothing at all — it simply matches no row.
    expect((await markNotificationRead({ id: bobsRow })).affected).toBe(0);
    expect((await archiveNotification({ id: bobsRow })).affected).toBe(0);
    expect((await unarchiveNotification({ id: bobsRow })).affected).toBe(0);

    const [bobs] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, bobsRow));
    expect(bobs?.readAt).toBeNull();
    expect(bobs?.archivedAt).toBeNull();

    // And "mark all read" stays inside its own lane.
    await markAllRead();
    const [stillBobs] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, bobsRow));
    expect(stillBobs?.readAt).toBeNull();
  });

  it("scopes to the active brand too — the same user, a different brand", async () => {
    await seedNotification({ accountId: ACCOUNT_A, title: "In A" });
    await seedNotification({ accountId: ACCOUNT_B, title: "In B" });

    expect(await unreadCount()).toBe(1);
    expect((await listNotifications({ tab: "all" })).rows.map((r) => r.title)).toEqual(["In A"]);

    setAccount(ACCOUNT_B);
    expect((await listNotifications({ tab: "all" })).rows.map((r) => r.title)).toEqual(["In B"]);
  });
});

describe("reading, clearing and finding", () => {
  it("counts only unread AND unarchived", async () => {
    await seedNotification({ title: "unread" });
    await seedNotification({ title: "read", readAt: new Date() });
    await seedNotification({ title: "archived", archivedAt: new Date() });
    expect(await unreadCount()).toBe(1);

    await markAllRead();
    expect(await unreadCount()).toBe(0);
  });

  it("archives instead of deleting, and restores", async () => {
    const id = await seedNotification({ title: "Clear me" });
    await archiveNotification({ id });

    const [row] = await db.select().from(notifications).where(eq(notifications.id, id));
    expect(row).toBeDefined(); // still there — nothing hard-deletes
    expect(row?.archivedAt).not.toBeNull();
    expect(row?.readAt).not.toBeNull(); // clearing also marks it read

    await unarchiveNotification({ id });
    const [back] = await db.select().from(notifications).where(eq(notifications.id, id));
    expect(back?.archivedAt).toBeNull();
  });

  it("hides archived rows from All and Unread, and finds them in Archived", async () => {
    await seedNotification({ title: "Live one", body: "budget plan saved" });
    await seedNotification({
      title: "Cleared one",
      body: "budget plan saved",
      archivedAt: new Date(),
      readAt: new Date(),
    });

    expect((await listNotifications({ tab: "all" })).rows.map((r) => r.title)).toEqual(["Live one"]);
    expect((await listNotifications({ tab: "unread" })).rows.map((r) => r.title)).toEqual(["Live one"]);
    expect((await listNotifications({ tab: "archived" })).rows.map((r) => r.title)).toEqual(["Cleared one"]);

    // Search reaches title AND body, and an archived row is searchable in its
    // own tab only.
    expect(
      (await listNotifications({ tab: "archived", q: "budget plan" })).rows.map((r) => r.title),
    ).toEqual(["Cleared one"]);
    expect(
      (await listNotifications({ tab: "all", q: "cleared" })).rows,
    ).toHaveLength(0);
    expect(
      (await listNotifications({ tab: "all", q: "live" })).rows.map((r) => r.title),
    ).toEqual(["Live one"]);
  });

  it("filters by category and pages the result", async () => {
    for (let i = 0; i < 3; i++) await seedNotification({ title: `system ${i}` });
    await db.insert(notifications).values({
      accountId: ACCOUNT_A,
      recipientUserId: ALICE,
      category: "alert",
      type: "budget.over_pace",
      title: "A phase-3 alert",
    });

    expect((await listNotifications({ tab: "all", categories: ["alert"] })).rows.map((r) => r.title)).toEqual([
      "A phase-3 alert",
    ]);
    const all = await listNotifications({ tab: "all" });
    expect(all.total).toBe(4);
    expect(all.page).toBe(1);

    // Page 2 of a 4-row set is empty, and says so without falling over.
    const page2 = await listNotifications({ tab: "all", page: 2 });
    expect(page2.rows).toHaveLength(0);
    expect(page2.total).toBe(4);
  });
});

describe("the direct event — brand access granted", () => {
  it("notifies the affected user, stamped to the GRANTED brand", async () => {
    // Bob is restricted to brand A; the admin adds brand B.
    await db.update(users).set({ allAccounts: false }).where(eq(users.id, BOB));
    const res = await updateUserBrands({
      userId: BOB,
      allAccounts: false,
      accountIds: [ACCOUNT_A, ACCOUNT_B],
    });
    expect(res.ok).toBe(true);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, BOB));
    // Both brands are newly granted (he had no membership rows before), and
    // each notification is stamped to the brand it is about.
    expect(rows.map((r) => r.accountId).sort()).toEqual([ACCOUNT_A, ACCOUNT_B].sort());
    expect(rows.every((r) => r.type === "user.brand_granted")).toBe(true);
    expect(rows.every((r) => r.actorUserId === ADMIN)).toBe(true);

    // Re-saving the same set grants nothing new, so nothing is sent again.
    await updateUserBrands({
      userId: BOB,
      allAccounts: false,
      accountIds: [ACCOUNT_A, ACCOUNT_B],
    });
    const after = await db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, BOB));
    expect(after).toHaveLength(rows.length);
  });

  it("writes nothing when the grant fails", async () => {
    const res = await updateUserBrands({
      userId: BOB,
      allAccounts: false,
      accountIds: [], // resolveGrant refuses: at least one brand is required
    });
    expect(res.ok).toBe(false);
    expect(
      await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, BOB)),
    ).toHaveLength(0);
  });
});

describe("createNotifications", () => {
  it("is one statement for many recipients, and a no-op for none", async () => {
    await db.transaction(async (tx) => {
      await createNotifications(tx, [
        {
          accountId: ACCOUNT_A,
          recipientUserId: ALICE,
          category: "system",
          type: "upload.committed",
          title: "One",
        },
        {
          accountId: ACCOUNT_A,
          recipientUserId: BOB,
          category: "system",
          type: "upload.committed",
          title: "Two",
        },
      ]);
      expect(await createNotifications(tx, [])).toBe(0);
    });
    expect(
      await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.accountId, ACCOUNT_A), eq(notifications.type, "upload.committed"))),
    ).toHaveLength(2);
  });
});
