import { describe, expect, it } from "vitest";
import { activeMentions, detectMentionQuery, highlightMentions, matchMembers } from "@/lib/comments";
import { commentHtml } from "@/lib/comment-markdown";
import { initialsOf } from "@/lib/avatar";

/**
 * A5 (2026-10) — mentions failed silently. Each block below failed on the code
 * before the fix.
 */

const ALI = { id: "1", name: "Ali" };
const ALI_HASSAN = { id: "2", name: "Ali Hassan" };
const ABDULSALAM = { id: "3", name: "Abdulsalam Ghazal", email: "salam@urjwan.com" };
const SARA_AR = { id: "4", name: "سارة" };
const ABD_AR = { id: "5", name: "عبد السلام غزال" };
const MEMBERS = [ALI, ALI_HASSAN, ABDULSALAM, SARA_AR, ABD_AR];

describe("the @query spans spaces while somebody still matches", () => {
  it("keeps listening through a full name — '@Abdulsalam Ghazal' stays one token", () => {
    const text = "hey @Abdulsalam Gh";
    expect(detectMentionQuery(text, text.length, MEMBERS)).toEqual({
      start: 4,
      query: "Abdulsalam Gh",
    });
    const full = "hey @Abdulsalam Ghazal";
    expect(matchMembers(MEMBERS, detectMentionQuery(full, full.length, MEMBERS)!.query)).toEqual([
      ABDULSALAM,
    ]);
  });

  it("closes cleanly once nobody matches", () => {
    const text = "@Ali hello there";
    expect(detectMentionQuery(text, text.length, MEMBERS)).toBeNull();
  });

  it("while the list is still LOADING (null) a spaced name stays open; with no list, a space ends it", () => {
    expect(detectMentionQuery("@Ali Has", 8, null)).toEqual({ start: 0, query: "Ali Has" });
    expect(detectMentionQuery("@Ali Has", 8)).toBeNull();
  });

  it("never opens on '@ ' and never crosses a line", () => {
    expect(detectMentionQuery("@ Ali", 5, MEMBERS)).toBeNull();
    expect(detectMentionQuery("@Ali\nHassan", 11, MEMBERS)).toBeNull();
  });

  it("works for Arabic names, and Arabic text around them", () => {
    const text = "شكرا @عبد السلام غ";
    expect(detectMentionQuery(text, text.length, MEMBERS)).toEqual({
      start: 5,
      query: "عبد السلام غ",
    });
    expect(matchMembers(MEMBERS, "سار")).toEqual([SARA_AR]);
  });
});

describe("a mention is the WHOLE name — a prefix never stands in for it", () => {
  it("'@Ali Hassan' does not keep a picked-then-deleted '@Ali' alive", () => {
    expect(activeMentions("@Ali Hassan please look", [ALI, ALI_HASSAN])).toEqual([ALI_HASSAN]);
  });

  it("'@Alice' is not a mention of Ali", () => {
    expect(activeMentions("@Alice can you", [ALI])).toEqual([]);
    expect(activeMentions("@Ali, can you", [ALI])).toEqual([ALI]);
  });

  it("Arabic: a name followed by more letters is a different word", () => {
    expect(activeMentions("مرحبا @سارة شكرا", [SARA_AR])).toEqual([SARA_AR]);
    expect(activeMentions("مرحبا @سارةو", [SARA_AR])).toEqual([]);
  });

  it("highlighting agrees: the longest recorded name wins, and spans never nest", () => {
    expect(commentHtml("@Ali Hassan please", ["Ali Hassan", "Ali"])).toBe(
      '<p><span class="cm-mention">@Ali Hassan</span> please</p>',
    );
    const both = commentHtml("@Ali Hassan and @Ali", ["Ali", "Ali Hassan"]);
    expect(both).toBe(
      '<p><span class="cm-mention">@Ali Hassan</span> and <span class="cm-mention">@Ali</span></p>',
    );
    expect(commentHtml("@Alice", ["Ali"])).not.toContain("cm-mention");
    expect(highlightMentions("@Alice", ["Ali"])).toEqual([{ text: "@Alice", mention: false }]);
  });

  it("never writes a mention span into a link's href", () => {
    const html = commentHtml("see https://x.com/?u=@Ali now", ["Ali"]);
    expect(html).toContain('href="https://x.com/?u=@Ali"');
    expect(html).not.toContain("cm-mention");
  });

  it("highlights Arabic and mixed-script mentions", () => {
    expect(commentHtml("شكرا @سارة.", ["سارة"])).toContain('<span class="cm-mention">@سارة</span>.');
    expect(commentHtml("Thanks @عبد السلام غزال for this", ["عبد السلام غزال"])).toContain(
      '<span class="cm-mention">@عبد السلام غزال</span>',
    );
    expect(commentHtml("شكرا @Abdulsalam Ghazal على المراجعة", ["Abdulsalam Ghazal"])).toContain(
      '<span class="cm-mention">@Abdulsalam Ghazal</span>',
    );
  });
});

describe("initials — first + last word, every script (user decision 2026-10-20)", () => {
  it("are the first and LAST words' letters — punctuation never stands in", () => {
    expect(initialsOf("Abdulsalam Ghazal")).toBe("AG");
    expect(initialsOf("Mary Jane Watson")).toBe("MW");
    expect(initialsOf("Salam (seed admin)")).toBe("SA");
    expect(initialsOf("Cher")).toBe("C");
    expect(initialsOf("   ")).toBe("?");
    expect(initialsOf(null)).toBe("?");
  });

  it("Arabic initials stay two separate letters — never joined into one glyph", () => {
    // U+200C ZERO WIDTH NON-JOINER keeps «ع» and «غ» as two letters.
    expect(initialsOf("عبد السلام غزال")).toBe("ع\u200Cغ");
    expect(initialsOf("سارة")).toBe("س");
    expect(initialsOf("Sara غزال")).toBe("Sغ");
  });
});
