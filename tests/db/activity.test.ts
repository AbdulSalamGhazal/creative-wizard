import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

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

vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: ALICE, name: "Alice", role: "editor" })),
  requireAuth: vi.fn(async () => ({ id: ALICE, name: "Alice", role: "editor" })),
  auth: vi.fn(async () => ({ id: ALICE, name: "Alice", role: "editor" })),
  can: vi.fn(() => false),
}));

import { auth, can, requireAuth } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { commentMentions, comments, users } from "@/db/schema";
import { listActivity } from "@/db/queries/activity";
import { NOTIFICATIONS_PAGE_SIZE } from "@/lib/notifications";
import type { ActivityParams } from "@/lib/activity";
import { CAMPAIGN_1, CREATIVE_1, resetAndSeed } from "./fixtures";

/**
 * The Activity feed's read. Pins: brand scoping, Mine, deleted rows never
 * shown, the page-refusal gate, orphaned anchors, the thread's shape (reply
 * marker, mentions), labels and paths per anchor kind, and paging.
 */

const ALL: ActivityParams = { who: "all", types: [], q: "", page: 1 };

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);
const setUser = (id: string, name: string) => {
  const session = { id, name, role: "editor" };
  vi.mocked(auth).mockResolvedValue(session as never);
  vi.mocked(requireAuth).mockResolvedValue(session as never);
};

/** A fixed instant, `minutesAgo` before it — so order is ours, not the clock's. */
const at = (minutesAgo: number) =>
  new Date(Date.UTC(2026, 9, 20, 12, 0, 0) - minutesAgo * 60_000);

let seq = 0;
const nextId = () => `55555555-5555-5555-5555-${String(++seq).padStart(12, "0")}`;

type CommentInsert = typeof comments.$inferInsert;

async function seedComment(over: Partial<CommentInsert> & { body: string }): Promise<string> {
  const id = over.id ?? nextId();
  await db.insert(comments).values({
    accountId: ACCOUNT_A,
    authorUserId: ALICE,
    anchorType: "creative",
    anchorId: CREATIVE_1,
    createdAt: at(0),
    ...over,
    id,
  });
  return id;
}

beforeEach(async () => {
  await resetAndSeed();
  await db.insert(users).values([
    { id: ALICE, email: "alice@test.local", name: "Alice", role: "editor" },
    { id: BOB, email: "bob@test.local", name: "Bob", role: "editor" },
  ]);
  setAccount(ACCOUNT_A);
  setUser(ALICE, "Alice");
  vi.mocked(can).mockReturnValue(false);
});

describe("scope", () => {
  it("is the active brand — and only the active brand", async () => {
    await seedComment({ body: "In A" });
    await seedComment({ body: "In B", accountId: ACCOUNT_B });

    expect((await listActivity(ALL)).rows.map((r) => r.body)).toEqual(["In A"]);
    setAccount(ACCOUNT_B);
    expect((await listActivity(ALL)).rows.map((r) => r.body)).toEqual(["In B"]);
  });

  it("Mine is the session user's comments; a former member's never match", async () => {
    await seedComment({ body: "Alice's", createdAt: at(1) });
    await seedComment({ body: "Bob's", authorUserId: BOB, createdAt: at(2) });
    await seedComment({ body: "Nobody's", authorUserId: null, createdAt: at(3) });

    const mine = await listActivity({ ...ALL, who: "me" });
    expect(mine.rows.map((r) => r.body)).toEqual(["Alice's"]);
    expect(mine.total).toBe(1);

    const everyone = await listActivity(ALL);
    expect(everyone.rows.map((r) => r.authorName)).toEqual(["Alice", "Bob", null]);
  });

  it("never shows a deleted comment, and never counts one", async () => {
    await seedComment({ body: "Live" });
    await seedComment({ body: "Gone", deletedAt: at(0) });

    const res = await listActivity(ALL);
    expect(res.rows.map((r) => r.body)).toEqual(["Live"]);
    expect(res.total).toBe(1);
  });

  it("hides a comment on a page that refuses the viewer, and shows it once they pass", async () => {
    await seedComment({ body: "On the Team page", anchorType: "view", anchorId: "/admin/users" });
    await seedComment({ body: "On Ads", anchorType: "view", anchorId: "/summary", createdAt: at(1) });

    const viewer = await listActivity(ALL);
    expect(viewer.rows.map((r) => r.body)).toEqual(["On Ads"]);
    expect(viewer.total).toBe(1);

    vi.mocked(can).mockReturnValue(true);
    const manager = await listActivity(ALL);
    expect(manager.rows.map((r) => r.body)).toEqual(["On the Team page", "On Ads"]);
    expect(manager.rows[0]!.anchorPath).toBe("/admin/users");
    expect(manager.rows[0]!.anchorLabel).not.toBeNull();
  });
});

describe("what a row carries", () => {
  it("the thread's shape: newest first, a reply names the root's author", async () => {
    const root = await seedComment({ body: "Root", createdAt: at(30) });
    await seedComment({ body: "Reply", authorUserId: BOB, parentId: root, createdAt: at(20) });

    const [reply, first] = (await listActivity(ALL)).rows;
    expect(reply!.body).toBe("Reply");
    expect(reply!.parentId).toBe(root);
    expect(reply!.parentAuthorName).toBe("Alice");
    expect(first!.parentAuthorName).toBeNull();
  });

  it("labels and paths per anchor kind, through the one path builder", async () => {
    await seedComment({ body: "creative", createdAt: at(1) });
    await seedComment({ body: "campaign", anchorType: "campaign", anchorId: CAMPAIGN_1, createdAt: at(2) });
    await seedComment({ body: "month", anchorType: "budget_month", anchorId: "2026-10", createdAt: at(3) });
    await seedComment({ body: "page", anchorType: "view", anchorId: "/summary", createdAt: at(4) });

    const rows = (await listActivity(ALL)).rows;
    expect(rows.map((r) => [r.anchorLabel, r.anchorPath])).toEqual([
      ["A-Creative-1", "/library/A-Creative-1"],
      ["Camp One ➤ Broad (IG)", `/campaigns/${encodeURIComponent("Camp One ➤ Broad (IG)")}`],
      ["October 2026", "/budget?month=2026-10"],
      ["Ads", "/summary"],
    ]);
  });

  it("a comment whose thing is gone stays listed, labelled null, with nowhere to go", async () => {
    await seedComment({ body: "Orphan", anchorId: "33333333-3333-3333-3333-333333333999" });
    await seedComment({ body: "Retired", anchorType: "view", anchorId: "/no-such-page", createdAt: at(1) });

    const rows = (await listActivity(ALL)).rows;
    expect(rows.map((r) => [r.body, r.anchorLabel, r.anchorPath])).toEqual([
      ["Orphan", null, null],
      ["Retired", null, null],
    ]);
  });

  it("carries the mentioned names, so the body highlights as it does in its thread", async () => {
    const id = await seedComment({ body: "Ping @Bob" });
    await db.insert(commentMentions).values({ commentId: id, userId: BOB });

    expect((await listActivity(ALL)).rows[0]!.mentionNames).toEqual(["Bob"]);
  });
});

describe("narrowing", () => {
  it("by anchor type, and by a case-insensitive body search", async () => {
    await seedComment({ body: "The Hook changed", createdAt: at(1) });
    await seedComment({ body: "Budget note", anchorType: "campaign", anchorId: CAMPAIGN_1, createdAt: at(2) });

    expect((await listActivity({ ...ALL, types: ["campaign"] })).rows.map((r) => r.body)).toEqual([
      "Budget note",
    ]);
    expect((await listActivity({ ...ALL, q: "hook" })).rows.map((r) => r.body)).toEqual([
      "The Hook changed",
    ]);
    expect((await listActivity({ ...ALL, q: "nothing here" })).total).toBe(0);
  });

  it("pages at the notifications page size, newest first across pages", async () => {
    const n = NOTIFICATIONS_PAGE_SIZE + 1;
    for (let i = 0; i < n; i++) await seedComment({ body: `c${i}`, createdAt: at(i) });

    const first = await listActivity(ALL);
    expect(first.total).toBe(n);
    expect(first.rows).toHaveLength(NOTIFICATIONS_PAGE_SIZE);
    expect(first.rows[0]!.body).toBe("c0");

    const second = await listActivity({ ...ALL, page: 2 });
    expect(second.rows.map((r) => r.body)).toEqual([`c${n - 1}`]);
    expect(second.page).toBe(2);
  });
});
