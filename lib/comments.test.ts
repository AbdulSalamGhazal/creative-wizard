import { describe, expect, it } from "vitest";
import {
  COMMENTABLE_VIEWS,
  COMMENT_PARAM,
  MENTION_QUERY_MAX,
  activeMentions,
  buildCommentTarget,
  detectMentionQuery,
  insertMentionToken,
  matchMembers,
  highlightMentions,
  isCommentableView,
  monthAnchorLabel,
  normalizeQuery,
  resolveCommentAnchor,
  rootParentId,
  showViewChip,
  splitCommentRecipients,
  viewAnchorFor,
  viewLabel,
} from "@/lib/comments";
import { NAV_ITEMS } from "@/components/layout/nav-items";

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

  it("builds a deep link from the CURRENT path, the captured view and ?comment", () => {
    // A query param, not a hash: the drawer has to READ it to open itself on
    // the comment, and a hash never reaches the router.
    expect(buildCommentTarget("/library/Ad-One", "from=2026-01-01", "c1")).toBe(
      `/library/Ad-One?from=2026-01-01&${COMMENT_PARAM}=c1`,
    );
    expect(buildCommentTarget("/summary", null, "c2")).toBe(`/summary?${COMMENT_PARAM}=c2`);
    // A path with its own query keeps it, and the captured view wins a clash.
    expect(buildCommentTarget("/budget?month=2026-09", "month=2026-08", "c3")).toBe(
      `/budget?month=2026-08&${COMMENT_PARAM}=c3`,
    );
    expect(buildCommentTarget("/budget?month=2026-09", "", "c4")).toBe(
      `/budget?month=2026-09&${COMMENT_PARAM}=c4`,
    );
    // An href is data: anything that isn't an in-app path resolves to nothing.
    expect(buildCommentTarget("https://example.com/evil", "", "c5")).toBeNull();
    expect(buildCommentTarget("//example.com", "", "c6")).toBeNull();
  });
});

describe("the view paths derive from the nav", () => {
  it("accepts every nav-listed page, admin included", () => {
    for (const view of COMMENTABLE_VIEWS) {
      expect(isCommentableView(view.path)).toBe(true);
      expect(viewLabel(view.path)).toBe(view.label);
    }
    // Derived, not re-listed: every nav href (or its children's) is here.
    for (const item of NAV_ITEMS) {
      const paths = item.children ? item.children.map((c) => c.href) : [item.href];
      for (const path of paths) expect(isCommentableView(path)).toBe(true);
    }
    // The admin section is commentable now.
    expect(isCommentableView("/admin/users")).toBe(true);
    expect(isCommentableView("/admin/audit")).toBe(true);
  });

  it("still refuses anything the nav doesn't offer", () => {
    // An entity page is anchored to the ENTITY, never to its pathname.
    expect(isCommentableView("/library/Some-Creative")).toBe(false);
    // `/trends` is a redirect stub; its children are the real pages.
    expect(isCommentableView("/trends")).toBe(false);
    expect(isCommentableView("/trends/over-time")).toBe(true);
    // A flow step, and the notifications feed itself.
    expect(isCommentableView("/uploads/new")).toBe(false);
    expect(isCommentableView("/notifications")).toBe(false);
    expect(isCommentableView("/../etc/passwd")).toBe(false);
    expect(viewLabel("/nope")).toBeNull();
  });
});

describe("which anchor the drawer points at", () => {
  const creative = { type: "creative" as const, id: "cr-1" };

  it("lets an ENTITY registration beat the page it was made on", () => {
    expect(
      resolveCommentAnchor({
        pathname: "/library/Ad-One",
        entity: { path: "/library/Ad-One", anchor: creative },
      }),
    ).toEqual(creative);
  });

  it("ignores a registration made on a DIFFERENT path", () => {
    // The stale one left behind by the page you just navigated away from.
    expect(
      resolveCommentAnchor({
        pathname: "/summary",
        entity: { path: "/library/Ad-One", anchor: creative },
      }),
    ).toEqual({ type: "view", id: "/summary" });
  });

  it("derives a view anchor for a nav page, and none for anything else", () => {
    expect(resolveCommentAnchor({ pathname: "/campaigns" })).toEqual({
      type: "view",
      id: "/campaigns",
    });
    expect(viewAnchorFor("/admin/catalog")).toEqual({
      type: "view",
      id: "/admin/catalog",
    });
    // No anchor → the drawer's icon is hidden rather than shown broken.
    expect(resolveCommentAnchor({ pathname: "/uploads/new" })).toBeNull();
    expect(resolveCommentAnchor({ pathname: "/notifications" })).toBeNull();
    expect(viewAnchorFor("/library/Ad-One")).toBeNull();
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

describe("inline @ — when the picker opens", () => {
  it("opens at the start of the text and after whitespace", () => {
    expect(detectMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(detectMentionQuery("@an", 3)).toEqual({ start: 0, query: "an" });
    expect(detectMentionQuery("hey @bo", 7)).toEqual({ start: 4, query: "bo" });
    expect(detectMentionQuery("line one\n@ca", 12)).toEqual({ start: 9, query: "ca" });
  });

  it("does NOT open mid-word or inside email-like text", () => {
    expect(detectMentionQuery("abc@", 4)).toBeNull();
    expect(detectMentionQuery("salam@urjwan.com", 16)).toBeNull();
    expect(detectMentionQuery("mail salam@urj", 14)).toBeNull();
  });

  it("closes once the token is left: a space, a caret before the @, or nothing typed", () => {
    expect(detectMentionQuery("@ann ", 5)).toBeNull(); // typed a space
    expect(detectMentionQuery("hi @ann", 2)).toBeNull(); // caret before the @
    expect(detectMentionQuery("", 0)).toBeNull();
    expect(detectMentionQuery("no mention", 10)).toBeNull();
    expect(detectMentionQuery(`@${"a".repeat(MENTION_QUERY_MAX + 1)}`, MENTION_QUERY_MAX + 2)).toBeNull();
  });

  it("reads the token under the CARET, not the end of the text", () => {
    // Editing in the middle of a draft: "@bo" is where the caret is.
    expect(detectMentionQuery("cc @bo and more", 6)).toEqual({ start: 3, query: "bo" });
  });
});

describe("inline @ — inserting and filtering", () => {
  it("replaces the typed @query with the full @Name and a trailing space", () => {
    const text = "hey @an please";
    const token = detectMentionQuery(text, 7)!;
    expect(insertMentionToken(text, token, 7, "Ann Lee")).toEqual({
      text: "hey @Ann Lee  please",
      caret: 13,
    });
  });

  it("matches on name or email, case-insensitively", () => {
    const members = [
      { id: "1", name: "Ann Lee", email: "ann@urjwan.com" },
      { id: "2", name: "Bob", email: "robert@urjwan.com" },
    ];
    expect(matchMembers(members, "ANN").map((m) => m.id)).toEqual(["1"]);
    expect(matchMembers(members, "robert").map((m) => m.id)).toEqual(["2"]);
    expect(matchMembers(members, "").map((m) => m.id)).toEqual(["1", "2"]);
    expect(matchMembers(members, "zed")).toEqual([]);
  });

  it("un-mentions someone whose @Name was deleted before posting", () => {
    const picked = [
      { id: "1", name: "Ann" },
      { id: "2", name: "Bob" },
    ];
    // Both were picked; Bob's token was then deleted from the draft.
    expect(activeMentions("@Ann thoughts?", picked).map((m) => m.id)).toEqual(["1"]);
    expect(activeMentions("no tokens left", picked)).toEqual([]);
  });
});
