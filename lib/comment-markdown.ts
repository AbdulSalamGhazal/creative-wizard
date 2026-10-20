/**
 * MARKDOWN-LITE for comments (2026-10, user-approved scope): **bold**,
 * *italic*, and `- ` bullet lists. Nothing else — no headings, no tables, no
 * code fences, and above all **no links as markdown**: `[x](javascript:…)` is
 * exactly the shape this file exists to refuse, so it stays literal text.
 *
 * Comments are stored as PLAIN TEXT. This is a render-time transformer, and it
 * is the only place in the app that produces HTML from user input.
 *
 * THE ORDER IS THE SECURITY MODEL:
 *   1. ESCAPE the whole body first. After this step no character in the input
 *      can begin a tag or an attribute — `<script>` is already `&lt;script&gt;`.
 *   2. Only then transform the three patterns and the mention highlights,
 *      inserting tags WE wrote.
 * Reversing those two steps is the bug this comment is here to prevent. Any
 * new pattern goes AFTER the escape, never before, and is matched against
 * escaped text.
 */

import { findMentions } from "@/lib/comments";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/**
 * A bare http(s) URL becomes a link. href-VALIDATED by construction: the
 * pattern only matches `http://` or `https://`, so `javascript:`, `data:` and
 * friends can never reach an href, and the rel carries noopener (+ noreferrer,
 * + nofollow — a comment is not an endorsement).
 */
const URL_RE = /\bhttps?:\/\/[^\s<"']+/g;

function linkify(escaped: string): string {
  return escaped.replace(URL_RE, (url) => {
    // A trailing sentence mark is punctuation, not part of the address.
    const trimmed = url.replace(/[.,;:!?)\]]+$/, "");
    const tail = url.slice(trimmed.length);
    // `dir="ltr"`: an address reads left-to-right even inside Arabic text,
    // and a `dir` attribute ISOLATES the run, so its trailing punctuation
    // can't reorder the sentence around it.
    return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer nofollow" dir="ltr">${trimmed}</a>${tail}`;
  });
}

/** `**bold**` then `*italic*` — longest marker first, so `**x**` isn't two italics. */
function emphasise(escaped: string): string {
  return escaped
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
}

/**
 * Highlight the names actually RECORDED as mentioned — presentation only,
 * exactly like `highlightMentions`: a typed "@someone" that never went through
 * the picker notifies nobody, so it must not look like it did.
 *
 * ONE pass through `findMentions` (2026-10), the same matcher the composer
 * uses to decide who is notified, so the two can never disagree. It used to be
 * one global replace per name: "@Ali" then matched INSIDE an already-wrapped
 * "@Ali Hassan" (a nested span), inside "@Alice", and inside a link's href.
 * Matching runs on TEXT only — never inside a tag we wrote, and never inside
 * a link — against escaped names, because the line is already escaped.
 */
function markMentions(html: string, names: readonly string[]): string {
  const escapedNames = names.filter((n) => n.trim() !== "").map((n) => escapeHtml(n));
  if (escapedNames.length === 0) return html;
  let inLink = false;
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith("<")) {
        if (/^<a[\s>]/.test(part)) inLink = true;
        else if (part === "</a>") inLink = false;
        return part;
      }
      if (inLink || part === "") return part;
      const spans = findMentions(part, escapedNames);
      if (spans.length === 0) return part;
      let out = "";
      let at = 0;
      for (const span of spans) {
        out += part.slice(at, span.start);
        // <bdi>: the name keeps its OWN direction inside text of the other
        // one — an Arabic name in English, an English name in Arabic.
        out += `<bdi class="cm-mention">${part.slice(span.start, span.end)}</bdi>`;
        at = span.end;
      }
      return out + part.slice(at);
    })
    .join("");
}

/** One line's inline transforms, in the order that keeps them composable. */
function inline(line: string, names: readonly string[]): string {
  return markMentions(emphasise(linkify(line)), names);
}

/**
 * Render a comment body to SAFE HTML. The output contains only tags this
 * module writes: `<p>`, `<strong>`, `<em>`, `<ul>/<li>`, `<a>` (http(s) only)
 * and the mention `<bdi>`.
 *
 * RTL, PER BLOCK (2026-10-20): every paragraph, list and list item carries
 * `dir="auto"` — a STATIC attribute this module writes, added to tags built
 * AFTER the escape (the escape-first order is untouched) — so an Arabic line
 * reads right-to-left and an English one left-to-right, side by side in one
 * comment, each deciding from its own first strong character.
 */
export function commentHtml(body: string, mentionNames: readonly string[] = []): string {
  const lines = escapeHtml(body).split("\n");
  const out: string[] = [];
  let list: string[] = [];

  const flush = () => {
    if (list.length === 0) return;
    out.push(`<ul dir="auto">${list.map((li) => `<li dir="auto">${li}</li>`).join("")}</ul>`);
    list = [];
  };

  for (const line of lines) {
    const bullet = /^\s*-\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(inline(bullet[1]!, mentionNames));
      continue;
    }
    flush();
    if (line.trim() === "") {
      out.push("<br>");
      continue;
    }
    out.push(`<p dir="auto">${inline(line, mentionNames)}</p>`);
  }
  flush();
  return out.join("");
}

// ── The composer's toolbar (pure, so the editing rules are testable) ────────

export type MarkdownTool = "bold" | "italic" | "list";

export interface SelectionEdit {
  text: string;
  /** Where the caret (or selection) should land afterwards. */
  start: number;
  end: number;
}

const WRAPPERS: Record<"bold" | "italic", string> = { bold: "**", italic: "*" };

/**
 * Apply a toolbar action to a selection. Wrapping a selection wraps it;
 * wrapping nothing drops the markers and puts the caret between them, so the
 * button is useful before you have typed. The list tool prefixes every line of
 * the selection (or the current line) with "- ", and toggles it off when every
 * line already has one — a toolbar that can only add is a trap.
 */
export function applyMarkdownTool(
  text: string,
  start: number,
  end: number,
  tool: MarkdownTool,
): SelectionEdit {
  if (tool === "list") {
    const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEndIdx = text.indexOf("\n", end);
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
    const block = text.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const allBulleted = lines.every((l) => /^\s*-\s+/.test(l) || l.trim() === "");
    const next = lines
      .map((l) =>
        l.trim() === ""
          ? l
          : allBulleted
            ? l.replace(/^(\s*)-\s+/, "$1")
            : `- ${l}`,
      )
      .join("\n");
    const out = text.slice(0, lineStart) + next + text.slice(lineEnd);
    return { text: out, start: lineStart, end: lineStart + next.length };
  }

  const marker = WRAPPERS[tool];
  const selected = text.slice(start, end);
  const out = `${text.slice(0, start)}${marker}${selected}${marker}${text.slice(end)}`;
  // Empty selection → caret between the markers, ready to type.
  const caret = start + marker.length;
  return selected
    ? { text: out, start: caret, end: caret + selected.length }
    : { text: out, start: caret, end: caret };
}
