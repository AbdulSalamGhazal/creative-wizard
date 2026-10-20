import { describe, expect, it } from "vitest";
import { REPLIES_VISIBLE, collapseReplies, newCommentIds } from "@/lib/comments";

const at = (min: number) => new Date(Date.UTC(2026, 9, 20, 10, min));
const c = (id: string, author: string | null, min: number, extra: { deleted?: boolean; pending?: boolean } = {}) => ({
  id,
  authorUserId: author,
  createdAt: at(min),
  deletedAt: extra.deleted ? at(min + 1) : null,
  pending: extra.pending,
});

describe("C2 — what is NEW to this reader", () => {
  const thread = [c("a", "sara", 1), c("b", "me", 5), c("c", "sara", 6), c("d", "omar", 7, { deleted: true }), c("e", null, 8)];

  it("is others' comments after where you left the thread — never yours, never a deleted one", () => {
    expect([...newCommentIds(thread, at(4), "me")]).toEqual(["c", "e"]);
  });

  it("a first visit has no baseline, so nothing is new", () => {
    expect(newCommentIds(thread, null, "me").size).toBe(0);
  });

  it("a comment at exactly the read time is not new; a pending post never is", () => {
    expect([...newCommentIds([c("x", "sara", 4), c("y", "sara", 9, { pending: true })], at(4), "me")]).toEqual([]);
  });
});

describe("C3 — long threads collapse to the latest replies", () => {
  const replies = ["r1", "r2", "r3", "r4", "r5"].map((id) => ({ id }));
  const none = new Set<string>();

  it(`shows the latest ${REPLIES_VISIBLE} and counts the rest`, () => {
    expect(collapseReplies(replies, { expanded: false, mustShow: none })).toEqual({
      hidden: 3,
      shown: [{ id: "r4" }, { id: "r5" }],
    });
  });

  it("never collapses a short thread, and opens when the reader asks", () => {
    expect(collapseReplies(replies.slice(0, 2), { expanded: false, mustShow: none }).hidden).toBe(0);
    expect(collapseReplies(replies, { expanded: true, mustShow: none }).shown).toHaveLength(5);
  });

  it("is FORCED open when the hidden range holds a deep-linked or new reply", () => {
    expect(collapseReplies(replies, { expanded: false, mustShow: new Set(["r2"]) }).hidden).toBe(0);
    // Something in the VISIBLE range doesn't force anything.
    expect(collapseReplies(replies, { expanded: false, mustShow: new Set(["r5"]) }).hidden).toBe(3);
  });
});
