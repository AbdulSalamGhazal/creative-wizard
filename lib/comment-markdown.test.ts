import { describe, expect, it } from "vitest";
import {
  applyMarkdownTool,
  commentHtml,
  escapeHtml,
} from "@/lib/comment-markdown";

// This module is the ONLY place in the app that turns user input into HTML, so
// these tests are deliberately adversarial: the escape-before-transform order
// is the whole security model, and a regression there is an XSS.

describe("escaping happens FIRST", () => {
  it("neutralises every tag character before anything is transformed", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    const html = commentHtml(`<script>alert('pwned')</script>`);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes a tag that markdown would otherwise wrap", () => {
    const html = commentHtml("**<img src=x onerror=alert(1)>**");
    expect(html).toContain("<strong>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("cannot be tricked into an attribute", () => {
    const html = commentHtml(`" onmouseover="alert(1)`);
    expect(html).not.toMatch(/onmouseover="alert/);
    expect(html).toContain("&quot;");
  });

  it("leaves an escaped ampersand alone instead of double-encoding meaning", () => {
    expect(commentHtml("Tom & Jerry")).toContain("Tom &amp; Jerry");
  });
});

describe("links are http(s) only — the href can never be a scheme we didn't allow", () => {
  it("links a bare https URL with a safe rel", () => {
    const html = commentHtml("see https://urjwan.com/x?a=1 please");
    expect(html).toContain(
      '<a href="https://urjwan.com/x?a=1" target="_blank" rel="noopener noreferrer nofollow">',
    );
  });

  it("NEVER links javascript:, data: or vbscript:", () => {
    for (const probe of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
    ]) {
      const html = commentHtml(probe);
      expect(html).not.toContain("<a ");
      expect(html).not.toContain("href=");
    }
  });

  it("keeps markdown LINK syntax literal — links are not markdown here", () => {
    const html = commentHtml("[click](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).toContain("[click](javascript:alert(1))");
  });

  it("leaves trailing sentence punctuation out of the address", () => {
    const html = commentHtml("read https://urjwan.com/docs.");
    expect(html).toContain('href="https://urjwan.com/docs"');
    expect(html).toContain("</a>.");
  });
});

describe("the three patterns", () => {
  it("bolds, italicises, and prefers the longer marker", () => {
    expect(commentHtml("**big**")).toContain("<strong>big</strong>");
    expect(commentHtml("*small*")).toContain("<em>small</em>");
    // `**x**` is ONE bold, never two italics around an empty middle.
    const html = commentHtml("**x**");
    expect(html).toContain("<strong>x</strong>");
    expect(html).not.toContain("<em>");
  });

  it("nests emphasis inside a bullet, and a mention inside emphasis", () => {
    const html = commentHtml("- **ship** it @Sara", ["Sara"]);
    expect(html).toContain("<ul><li>");
    expect(html).toContain("<strong>ship</strong>");
    expect(html).toContain('<span class="cm-mention">@Sara</span>');
  });

  it("groups consecutive bullets into ONE list and closes it after", () => {
    const html = commentHtml("- one\n- two\nafter");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<p>after</p>");
    expect(html.indexOf("</ul>")).toBeLessThan(html.indexOf("<p>after"));
  });

  it("leaves an unmatched marker as text", () => {
    expect(commentHtml("2 * 3 = 6")).toContain("2 * 3 = 6");
    expect(commentHtml("**unclosed")).toContain("**unclosed");
  });

  it("highlights only the names actually recorded as mentioned", () => {
    const html = commentHtml("@Sara and @Nobody", ["Sara"]);
    expect(html).toContain('<span class="cm-mention">@Sara</span>');
    expect(html).toContain("@Nobody");
    expect(html).not.toContain('class="cm-mention">@Nobody');
  });

  it("escapes a mention name before using it as a pattern", () => {
    const html = commentHtml("@<b>x</b>", ["<b>x</b>"]);
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("the toolbar edits (pure)", () => {
  it("wraps a selection and keeps it selected", () => {
    const out = applyMarkdownTool("ship it", 0, 4, "bold");
    expect(out.text).toBe("**ship** it");
    expect(out.text.slice(out.start, out.end)).toBe("ship");
  });

  it("drops markers and puts the caret between them with no selection", () => {
    const out = applyMarkdownTool("", 0, 0, "italic");
    expect(out.text).toBe("**");
    expect(out.start).toBe(1);
    expect(out.end).toBe(1);
  });

  it("bullets every line of the selection, and toggles them off again", () => {
    const on = applyMarkdownTool("one\ntwo", 0, 7, "list");
    expect(on.text).toBe("- one\n- two");
    const off = applyMarkdownTool(on.text, 0, on.text.length, "list");
    expect(off.text).toBe("one\ntwo");
  });

  it("bullets the CURRENT line when nothing is selected", () => {
    const out = applyMarkdownTool("alpha\nbeta", 7, 7, "list");
    expect(out.text).toBe("alpha\n- beta");
  });
});
