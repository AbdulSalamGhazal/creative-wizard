import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

const ADMIN = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures
const ALICE = "11111111-1111-1111-1111-1111111111a1";
const BOB = "11111111-1111-1111-1111-1111111111b1";
const CAROL = "11111111-1111-1111-1111-1111111111c1";
const OUTSIDER = "11111111-1111-1111-1111-1111111111d1";

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
import { campaigns, comments, creatives, notifications, users } from "@/db/schema";
import {
  createComment,
  deleteComment,
  updateComment,
} from "@/app/actions/comments";
import { listComments, resolveAnchorPath } from "@/db/queries/comments";
import { buildCommentTarget } from "@/lib/comments";
import { CREATIVE_1, CAMPAIGN_1, CAMPAIGN_B, resetAndSeed } from "./fixtures";

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);
const setUser = (id: string, name: string, role: "admin" | "editor" = "editor") => {
  const session = { id, name, role };
  vi.mocked(auth).mockResolvedValue(session as never);
  vi.mocked(requireAuth).mockResolvedValue(session as never);
};

beforeEach(async () => {
  await resetAndSeed();
  await db.insert(users).values([
    { id: ALICE, email: "alice@test.local", name: "Alice", role: "editor" },
    { id: BOB, email: "bob@test.local", name: "Bob", role: "editor" },
    { id: CAROL, email: "carol@test.local", name: "Carol", role: "editor" },
    // Restricted to brand B only — not a member of A.
    {
      id: OUTSIDER,
      email: "out@test.local",
      name: "Outsider",
      role: "editor",
      allAccounts: false,
    },
  ]);
  setAccount(ACCOUNT_A);
  setUser(ALICE, "Alice");
  vi.mocked(can).mockReturnValue(false);
});

const onCreative = {
  anchorType: "creative" as const,
  anchorId: CREATIVE_1,
};

describe("anchors are re-validated against the active brand", () => {
  it("refuses another brand's campaign, and a page that isn't commentable", async () => {
    const foreign = await createComment({
      anchorType: "campaign",
      anchorId: CAMPAIGN_B, // belongs to ACCOUNT_B
      body: "Can I comment across brands?",
    });
    expect(foreign.ok).toBe(false);

    // The admin section IS commentable now (the path set derives from the
    // nav) — what stays refused is a path the nav doesn't offer.
    const notAPage = await createComment({
      anchorType: "view",
      anchorId: "/uploads/new",
      body: "Commenting on a flow step",
    });
    expect(notAPage.ok).toBe(false);

    const itsOwnFeed = await createComment({
      anchorType: "view",
      anchorId: "/notifications",
      body: "Commenting on the notifications feed",
    });
    expect(itsOwnFeed.ok).toBe(false);

    const madeUp = await createComment({
      anchorType: "creative",
      anchorId: "33333333-3333-3333-3333-333333333999",
      body: "Ghost creative",
    });
    expect(madeUp.ok).toBe(false);

    expect(await db.select().from(comments)).toHaveLength(0);
  });

  it("accepts an allow-listed page and stores the view verbatim", async () => {
    const res = await createComment({
      anchorType: "view",
      anchorId: "/summary",
      viewQuery: "?from=2026-01-01&to=2026-01-31&platforms=tiktok",
      body: "TikTok looks off in this window",
    });
    expect(res.ok).toBe(true);
    const [row] = await db.select().from(comments);
    // The leading "?" is stripped; everything else is kept exactly.
    expect(row?.viewQuery).toBe("from=2026-01-01&to=2026-01-31&platforms=tiktok");
  });
});

describe("mentions", () => {
  it("refuses a mention of someone who can't see this brand", async () => {
    const res = await createComment({
      ...onCreative,
      body: "Hey @Outsider",
      mentionUserIds: [OUTSIDER],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/access to this brand/i);
    expect(await db.select().from(comments)).toHaveLength(0);
  });

  it("notifies each mentioned member, never the author", async () => {
    const res = await createComment({
      ...onCreative,
      body: "@Bob @Alice take a look",
      mentionUserIds: [BOB, ALICE],
    });
    expect(res.ok).toBe(true);

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recipientUserId).toBe(BOB);
    expect(rows[0]!.category).toBe("mention");
    expect(rows[0]!.title).toContain("Alice mentioned you on");
    expect(rows[0]!.href).toBe(`/go/comment/${res.id}`);
  });

  it("a top-level comment with no mentions notifies NOBODY", async () => {
    const res = await createComment({ ...onCreative, body: "Just noting this here." });
    expect(res.ok).toBe(true);
    expect(await db.select().from(notifications)).toHaveLength(0);
  });
});

describe("replies", () => {
  it("notifies the thread — root author, repliers, prior mentions — minus the actor and anyone newly mentioned", async () => {
    // Alice opens a thread and mentions Carol.
    const root = await createComment({
      ...onCreative,
      body: "Spend spiked here, @Carol",
      mentionUserIds: [CAROL],
    });
    // Bob replies, joining the thread.
    setUser(BOB, "Bob");
    await createComment({ ...onCreative, parentId: root.id, body: "Looking now" });
    await db.delete(notifications); // clear the first two rounds

    // Carol replies and mentions Alice: Alice gets a MENTION (not a reply),
    // Bob gets a REPLY, Carol hears nothing about her own comment.
    setUser(CAROL, "Carol");
    const reply = await createComment({
      ...onCreative,
      parentId: root.id,
      body: "@Alice it was the new campaign",
      mentionUserIds: [ALICE],
    });
    expect(reply.ok).toBe(true);

    const rows = await db.select().from(notifications);
    const byUser = new Map(rows.map((r) => [r.recipientUserId, r]));
    expect(rows).toHaveLength(2);
    expect(byUser.get(ALICE)?.category).toBe("mention"); // mention wins
    expect(byUser.get(BOB)?.category).toBe("reply");
    expect(byUser.has(CAROL)).toBe(false); // the actor
  });

  it("keeps threads FLAT — a reply to a reply re-parents to the root", async () => {
    const root = await createComment({ ...onCreative, body: "Root" });
    setUser(BOB, "Bob");
    const first = await createComment({
      ...onCreative,
      parentId: root.id,
      body: "First reply",
    });
    const second = await createComment({
      ...onCreative,
      parentId: first.id, // replying to the REPLY
      body: "Reply to the reply",
    });

    const [row] = await db.select().from(comments).where(eq(comments.id, second.id!));
    expect(row?.parentId).toBe(root.id);

    const thread = await listComments("creative", CREATIVE_1);
    expect(thread.filter((c) => c.parentId === null)).toHaveLength(1);
    expect(thread.filter((c) => c.parentId === root.id)).toHaveLength(2);
  });

  it("refuses a reply whose parent belongs to a different anchor", async () => {
    const root = await createComment({ ...onCreative, body: "On the creative" });
    const res = await createComment({
      anchorType: "campaign",
      anchorId: CAMPAIGN_1,
      parentId: root.id,
      body: "Smuggled onto the campaign",
    });
    expect(res.ok).toBe(false);
  });
});

describe("edit and delete", () => {
  it("edit is author-only and marks the comment edited", async () => {
    const root = await createComment({ ...onCreative, body: "Original" });

    setUser(BOB, "Bob");
    const notMine = await updateComment({ id: root.id, body: "Rewritten by Bob" });
    expect(notMine.ok).toBe(false);

    setUser(ALICE, "Alice");
    const mine = await updateComment({ id: root.id, body: "Edited" });
    expect(mine.ok).toBe(true);
    const [row] = await db.select().from(comments).where(eq(comments.id, root.id!));
    expect(row?.body).toBe("Edited");
    expect(row?.editedAt).not.toBeNull();
  });

  it("soft-deletes: the row survives as a placeholder and its replies stay", async () => {
    const root = await createComment({ ...onCreative, body: "Delete me" });
    setUser(BOB, "Bob");
    await createComment({ ...onCreative, parentId: root.id, body: "Reply that must survive" });

    // Bob can't delete Alice's comment…
    const refused = await deleteComment({ id: root.id });
    expect(refused.ok).toBe(false);

    // …but an admin can.
    setUser(ADMIN, "Harness", "admin");
    const admin = await deleteComment({ id: root.id });
    expect(admin.ok).toBe(true);

    const [row] = await db.select().from(comments).where(eq(comments.id, root.id!));
    expect(row).toBeDefined(); // NOT hard-deleted
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.body).toBe("Delete me"); // the body stays for the audit trail

    const thread = await listComments("creative", CREATIVE_1);
    expect(thread).toHaveLength(2); // the reply is still there under it
  });
});

describe("reads are account-scoped", () => {
  it("never returns another brand's comments for the same anchor", async () => {
    await createComment({ ...onCreative, body: "Brand A's comment" });
    // Same anchor id, different brand — only possible by writing directly.
    await db.insert(comments).values({
      accountId: ACCOUNT_B,
      authorUserId: BOB,
      anchorType: "creative",
      anchorId: CREATIVE_1,
      body: "Brand B's comment",
    });

    expect((await listComments("creative", CREATIVE_1)).map((c) => c.body)).toEqual([
      "Brand A's comment",
    ]);
    setAccount(ACCOUNT_B);
    expect((await listComments("creative", CREATIVE_1)).map((c) => c.body)).toEqual([
      "Brand B's comment",
    ]);
  });
});

describe("the /go resolver's reason to exist", () => {
  it("resolves to the CURRENT name after a rename", async () => {
    const res = await createComment({
      ...onCreative,
      viewQuery: "from=2026-01-01&to=2026-01-31",
      body: "Look at this window",
    });

    await db
      .update(creatives)
      .set({ name: "Renamed-Creative" })
      .where(eq(creatives.id, CREATIVE_1));

    const anchor = await resolveAnchorPath("creative", CREATIVE_1, ACCOUNT_A);
    expect(anchor?.path).toBe("/library/Renamed-Creative");
    expect(buildCommentTarget(anchor!.path, "from=2026-01-01&to=2026-01-31", res.id!)).toBe(
      `/library/Renamed-Creative?from=2026-01-01&to=2026-01-31&comment=${res.id}`,
    );
  });

  it("resolves a campaign by its current name, and refuses across brands", async () => {
    await db
      .update(campaigns)
      .set({ name: "Camp One ➤ Renamed (IG)" })
      .where(eq(campaigns.id, CAMPAIGN_1));

    const mine = await resolveAnchorPath("campaign", CAMPAIGN_1, ACCOUNT_A);
    expect(mine?.path).toBe(`/campaigns/${encodeURIComponent("Camp One ➤ Renamed (IG)")}`);

    // Another brand's campaign resolves to nothing — the link dead-ends
    // rather than confirming the campaign exists.
    expect(await resolveAnchorPath("campaign", CAMPAIGN_B, ACCOUNT_A)).toBeNull();
  });

  it("resolves a budget month and a view without touching the database", async () => {
    expect(await resolveAnchorPath("budget_month", "2026-09", ACCOUNT_A)).toEqual({
      path: "/budget?month=2026-09",
      label: "September 2026",
    });
    expect(await resolveAnchorPath("view", "/summary", ACCOUNT_A)).toEqual({
      path: "/summary",
      label: "Ads",
    });
    // A nav page the admin section offers resolves too.
    expect(await resolveAnchorPath("view", "/admin/users", ACCOUNT_A)).toEqual({
      path: "/admin/users",
      label: "Team",
    });
    // A pathname the nav doesn't offer resolves to nothing.
    expect(await resolveAnchorPath("view", "/uploads/new", ACCOUNT_A)).toBeNull();
  });
});
