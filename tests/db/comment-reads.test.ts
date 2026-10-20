import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { ACCOUNT_A } from "./config";

const ALICE = "11111111-1111-1111-1111-1111111111a1";
const BOB = "11111111-1111-1111-1111-1111111111b1";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  listAllAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: ALICE, name: "Alice", role: "editor" })),
  requireAuth: vi.fn(async () => ({ id: ALICE, name: "Alice", role: "editor" })),
  auth: vi.fn(async () => ({ id: ALICE, name: "Alice", role: "editor" })),
  can: vi.fn(() => false),
}));

import { auth, requireAuth } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { commentReads, notifications, users } from "@/db/schema";
import { createComment } from "@/app/actions/comments";
import { markThreadRead } from "@/app/actions/comment-reads";
import { CAMPAIGN_B, CREATIVE_1, CREATIVE_2, resetAndSeed } from "./fixtures";

const setUser = (id: string, name: string) => {
  const session = { id, name, role: "editor" };
  vi.mocked(auth).mockResolvedValue(session as never);
  vi.mocked(requireAuth).mockResolvedValue(session as never);
};

beforeEach(async () => {
  await resetAndSeed();
  await db.insert(users).values([
    { id: ALICE, email: "alice@test.local", name: "Alice", role: "editor" },
    { id: BOB, email: "bob@test.local", name: "Bob", role: "editor" },
  ]);
  vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A);
  setUser(ALICE, "Alice");
});

const onCreative = { anchorType: "creative" as const, anchorId: CREATIVE_1 };

describe("opening a thread (2026-10-20) — the 'New' snapshot and the read state", () => {
  it("a FIRST visit has no previous read; the next one returns where you left it", async () => {
    setUser(BOB, "Bob");
    const first = await markThreadRead(onCreative);
    expect(first).toMatchObject({ ok: true, previousReadAt: null, cleared: 0 });
    const [row] = await db.select().from(commentReads);
    expect(row).toMatchObject({ userId: BOB, accountId: ACCOUNT_A, anchorType: "creative", anchorId: CREATIVE_1 });

    const second = await markThreadRead(onCreative);
    expect(second.ok).toBe(true);
    expect(new Date(second.previousReadAt!).getTime()).toBe(row!.lastReadAt.getTime());
    // One row per (user, brand, anchor), however often it is opened.
    expect(await db.select().from(commentReads)).toHaveLength(1);
  });

  it("marks YOUR unread comment notifications for THIS anchor read — nobody else's, nothing elsewhere", async () => {
    // Alice mentions Bob on creative 1 and on creative 2.
    for (const anchorId of [CREATIVE_1, CREATIVE_2]) {
      const res = await createComment({
        anchorType: "creative",
        anchorId,
        body: "@Bob look",
        mentionUserIds: [BOB],
      });
      expect(res.ok).toBe(true);
    }
    // Bob replies on creative 1 → Alice gets a reply notification there.
    setUser(BOB, "Bob");
    const [root] = await db.select().from(notifications).where(eq(notifications.entityId, CREATIVE_1));
    expect(root).toBeTruthy();

    const opened = await markThreadRead(onCreative);
    expect(opened).toMatchObject({ ok: true, cleared: 1 });

    const bobs = await db
      .select({ entityId: notifications.entityId, readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.recipientUserId, BOB));
    expect(bobs.find((n) => n.entityId === CREATIVE_1)?.readAt).not.toBeNull();
    // The other anchor's mention is still unread.
    expect(bobs.find((n) => n.entityId === CREATIVE_2)?.readAt).toBeNull();
  });

  it("leaves non-comment notifications about the same entity alone", async () => {
    await db.insert(notifications).values({
      accountId: ACCOUNT_A,
      recipientUserId: BOB,
      category: "system",
      type: "creative.updated",
      title: "Something else about this creative",
      entityType: "creative",
      entityId: CREATIVE_1,
    });
    setUser(BOB, "Bob");
    expect(await markThreadRead(onCreative)).toMatchObject({ ok: true, cleared: 0 });
    const [row] = await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.recipientUserId, BOB), eq(notifications.type, "creative.updated")));
    expect(row?.readAt).toBeNull();
  });

  it("is account-scoped: another brand's anchor is refused, and writes nothing", async () => {
    const res = await markThreadRead({ anchorType: "campaign", anchorId: CAMPAIGN_B });
    expect(res.ok).toBe(false);
    expect(await db.select().from(commentReads)).toHaveLength(0);
  });

  it("validates the anchor's shape", async () => {
    expect((await markThreadRead({ anchorType: "view", anchorId: "/not-a-page" })).ok).toBe(false);
    expect((await markThreadRead({ anchorType: "creative", anchorId: "nope" })).ok).toBe(false);
  });
});
