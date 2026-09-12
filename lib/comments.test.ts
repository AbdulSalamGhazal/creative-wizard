import { describe, expect, it } from "vitest";
import {
  COMMENTABLE_VIEWS,
  buildCommentTarget,
  highlightMentions,
  isCommentableView,
  monthAnchorLabel,
  normalizeQuery,
  rootParentId,
  showViewChip,
  splitCommentRecipients,
  viewLabel,
} from "@/lib/comments";

describe("flat threads", () => {
  it("re-parents a reply-to-a-reply onto the thread's root", () => {
    const root = { id: "root-1", parentId: null };
    const reply = { id: "reply-1", parentId: "root-1" };
    expect(rootParentId(root)).toBe("root-1");
    // The second level never appears: replying to a reply joins its thread.
    expect(rootParentId(reply)).toBe("root-1");
  });
});

describe("who a comment notifies", () => {
  const actor = "u-actor";

  it("mentions win — nobody gets two notifications for one comment", () => {
    const split = splitCommentRecipients({
      actorUserId: actor,
      mentioned: ["u-b"],
      participants: ["u-b", "u-c"],
    });
    expect(split.mention).toEqual(["u-b"]);
    expect(split.reply).toEqual(["u-c"]); // u-b is NOT told twice
  });

  it("never notifies the actor, in either flavour", () => {
    const split = splitCommentRecipients({
      actorUserId: actor,
      mentioned: [actor, "u-b"],
      participants: [actor, "u-c"],
    });
    expect(split.mention).toEqual(["u-b"]);
    expect(split.reply).toEqual(["u-c"]);
  });

  it("a top-level comment with no mentions reaches nobody", () => {
    const split = splitCommentRecipients({
      actorUserId: actor,
      mentioned: [],
      participants: [], // no thread yet
    });
    expect(split.mention).toEqual([]);
    expect(split.reply).toEqual([]);
  });

  it("dedupes repeated ids on both sides", () => {
    const split = splitCommentRecipients({
      actorUserId: actor,
      mentioned: ["u-b", "u-b"],
      participants: ["u-c", "u-c", "u-c"],
    });
    expect(split.mention).toEqual(["u-b"]);
    expect(split.reply).toEqual(["u-c"]);
  });
});

describe("the captured view", () => {
  it("treats two spellings of the same query as one view", () => {
    expect(normalizeQuery("b=2&a=1")).toBe(normalizeQuery("a=1&b=2"));
    expect(normalizeQuery("?a=1")).toBe("a=1");
    expect(normalizeQuery("")).toBe("");
    expect(normalizeQuery(null)).toBe("");
    // An empty value carries no view information.
    expect(normalizeQuery("a=&b=2")).toBe("b=2");
  });

  it("offers the chip only when the stored view differs from the current one", () => {
    expect(showViewChip("from=2026-01-01&to=2026-01-31", "")).toBe(true);
    expect(showViewChip("a=1&b=2", "b=2&a=1")).toBe(false); // the same view
    expect(showViewChip("", "a=1")).toBe(false); // nothing captured
    expect(showViewChip(null, "a=1")).toBe(false);
    expect(showViewChip("a=1", "a=2")).toBe(true);
  });

  it("builds a deep link from the CURRENT path, the captured view and the anchor", () => {
    expect(buildCommentTarget("/library/Ad-One", "from=2026-01-01", "c1")).toBe(
      "/library/Ad-One?from=2026-01-01#comment-c1",
    );
    expect(buildCommentTarget("/summary", null, "c2")).toBe("/summary#comment-c2");
    // A path with its own query keeps it, and the captured view wins a clash.
    expect(buildCommentTarget("/budget?month=2026-09", "month=2026-08", "c3")).toBe(
      "/budget?month=2026-08#comment-c3",
    );
    expect(buildCommentTarget("/budget?month=2026-09", "", "c4")).toBe(
      "/budget?month=2026-09#comment-c4",
    );
    // An href is data: anything that isn't an in-app path resolves to nothing.
    expect(buildCommentTarget("https://example.com/evil", "", "c5")).toBeNull();
    expect(buildCommentTarget("//example.com", "", "c6")).toBeNull();
  });
});

describe("the view allow-list", () => {
  it("accepts exactly the listed pages", () => {
    for (const view of COMMENTABLE_VIEWS) {
      expect(isCommentableView(view.path)).toBe(true);
      expect(viewLabel(view.path)).toBe(view.label);
    }
    expect(isCommentableView("/library/Some-Creative")).toBe(false);
    expect(isCommentableView("/admin/users")).toBe(false);
    // `/trends` is a redirect stub; the page it lands on is what's listed.
    expect(isCommentableView("/trends")).toBe(false);
    expect(isCommentableView("/trends/over-time")).toBe(true);
    expect(viewLabel("/nope")).toBeNull();
  });
});

describe("rendering mentions", () => {
  it("highlights only names that were actually mentioned", () => {
    const segments = highlightMentions("Hey @Ann, ask @Nobody about this", ["Ann"]);
    expect(segments).toEqual([
      { text: "Hey ", mention: false },
      { text: "@Ann", mention: true },
      // A typed "@Nobody" never went through the picker, so it stays plain —
      // which is honest: it notified nobody.
      { text: ", ask @Nobody about this", mention: false },
    ]);
  });

  it("prefers the longest matching name", () => {
    const segments = highlightMentions("cc @Ann Lee please", ["Ann", "Ann Lee"]);
    expect(segments[1]).toEqual({ text: "@Ann Lee", mention: true });
  });

  it("passes a body through untouched when nothing is mentioned", () => {
    expect(highlightMentions("plain text", [])).toEqual([
      { text: "plain text", mention: false },
    ]);
  });
});

describe("anchor labels", () => {
  it("names a budget month the way people say it", () => {
    expect(monthAnchorLabel("2026-09")).toBe("September 2026");
    expect(monthAnchorLabel("nonsense")).toBe("nonsense");
  });
});
