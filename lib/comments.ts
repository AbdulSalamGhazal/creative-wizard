import { safeHref } from "@/lib/notifications";
import { NAV_ITEMS } from "@/components/layout/nav-items";

/**
 * Comments — the pure layer (phase 2 of notifications).
 *
 * Two ideas carry the whole feature:
 *
 *  1. **A comment captures the view it was written in.** The anchor implies the
 *     pathname; the query string (filters, date range, sort) is stored verbatim
 *     at post time. A recipient's deep link therefore reproduces exactly what
 *     the commenter was looking at — "this looks wrong" means nothing if the
 *     reader arrives with different filters. One rule, no special cases: an
 *     entity comment stores the query it was written under, and an aggregate
 *     ("view") comment stores the pathname too.
 *  2. **A comment notifies only by MENTION or REPLY.** Nothing is broadcast, so
 *     commenting is never a way to page the whole team.
 */

export const COMMENT_ANCHOR_TYPES = [
  "creative",
  "campaign",
  "budget_month",
  "view",
] as const;

export type CommentAnchorType = (typeof COMMENT_ANCHOR_TYPES)[number];

export function isCommentAnchorType(value: string): value is CommentAnchorType {
  return (COMMENT_ANCHOR_TYPES as readonly string[]).includes(value);
}

/**
 * Pages that accept a "view" comment, DERIVED from the nav (house rule: derive,
 * don't re-list). Every page the sidebar offers — the admin section included —
 * is commentable; the old hand-listed nine are gone, and a page added to
 * `NAV_ITEMS` becomes commentable without touching this file.
 *
 * The derivation still matters as a check, not a formality: `anchor_id` for a
 * view is a pathname, and an unchecked pathname is an open door (a comment
 * anchored to an arbitrary string, and a deep link to wherever it says).
 */
const NOT_COMMENTABLE = new Set<string>([
  // Its own feed — commenting on the list of comments-about-things is a loop.
  "/notifications",
]);

export const COMMENTABLE_VIEWS: ReadonlyArray<{ path: string; label: string }> =
  (() => {
    const out: Array<{ path: string; label: string }> = [];
    const seen = new Set<string>();
    const add = (path: string, label: string) => {
      if (seen.has(path) || NOT_COMMENTABLE.has(path)) return;
      seen.add(path);
      out.push({ path, label });
    };
    for (const item of NAV_ITEMS) {
      // A hub item's href is its first child's, so the children carry the
      // labels people would recognise ("Angles", not "Trends").
      if (item.children) for (const child of item.children) add(child.href, child.label);
      else add(item.href, item.label);
    }
    return out;
  })();

export function isCommentableView(path: string): boolean {
  return COMMENTABLE_VIEWS.some((v) => v.path === path);
}

export function viewLabel(path: string): string | null {
  return COMMENTABLE_VIEWS.find((v) => v.path === path)?.label ?? null;
}

/** "September 2026" — a budget-month anchor's human label. */
export function monthAnchorLabel(month: string): string {
  const [year, m] = month.split("-");
  const index = Number(m) - 1;
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return names[index] ? `${names[index]} ${year}` : month;
}

/** Body bounds — mirrored by the zod schema, shared with the composer's UI. */
export const COMMENT_MAX = 2000;
export const VIEW_QUERY_MAX = 2000;
/** The list is a conversation, not an archive: newest 100 threads. */
export const COMMENT_THREAD_LIMIT = 100;

export interface CommentAnchor {
  type: CommentAnchorType;
  id: string;
}

/**
 * REACTIONS (2026-10) — exactly five, and the SHORT KEY is what is stored.
 *
 * The key is the durable thing: rows in `comment_reactions` carry it, so the
 * five keys are effectively schema and must not be renamed. The emoji is
 * presentation and could change without a migration. Everything — the picker,
 * the pills, the validator, the notification wording — derives from this array;
 * never re-list the kinds at a consumer.
 */
export const COMMENT_REACTIONS = [
  { key: "up", emoji: "\u{1F44D}", label: "Thumbs up" },
  { key: "heart", emoji: "\u{2764}\u{FE0F}", label: "Heart" },
  { key: "party", emoji: "\u{1F389}", label: "Party" },
  { key: "laugh", emoji: "\u{1F602}", label: "Laugh" },
  { key: "wow", emoji: "\u{1F62E}", label: "Wow" },
] as const;

export type CommentReaction = (typeof COMMENT_REACTIONS)[number]["key"];

/** Derived — never hand-list the keys. */
export const COMMENT_REACTION_KEYS: readonly CommentReaction[] = COMMENT_REACTIONS.map(
  (r) => r.key,
);

export function isCommentReaction(value: string): value is CommentReaction {
  return (COMMENT_REACTION_KEYS as readonly string[]).includes(value);
}

/**
 * How a kind RENDERS. A stored kind that is no longer in the vocabulary falls
 * back to the raw key rather than disappearing — rows outlive catalogs, the
 * same rule `categoryForType` follows for notification types.
 */
export function reactionEmoji(kind: string): string {
  return COMMENT_REACTIONS.find((r) => r.key === kind)?.emoji ?? kind;
}

export function reactionLabel(kind: string): string {
  return COMMENT_REACTIONS.find((r) => r.key === kind)?.label ?? kind;
}

/** One kind's tally on one comment — what the thread payload carries. */
export interface CommentReactionTally {
  kind: string;
  count: number;
  /** Did the current reader react this way? Drives the tint and the toggle. */
  mine: boolean;
  /** A few reactor names for the tooltip — not the whole list. */
  names: string[];
}

/** How many names a pill's tooltip spells out before saying "and N more". */
export const REACTION_TOOLTIP_NAMES = 5;

/** "Sara, Omar and 3 others reacted 👍" — the pill's tooltip, one rule. */
export function reactionTooltip(tally: CommentReactionTally): string {
  const emoji = reactionEmoji(tally.kind);
  const shown = tally.names.slice(0, REACTION_TOOLTIP_NAMES);
  // No names at hand (deleted accounts) still says something true, and must not
  // then count those same people again as "others".
  if (shown.length === 0) {
    return `${tally.count} ${tally.count === 1 ? "person" : "people"} reacted ${emoji}`;
  }
  const rest = Math.max(0, tally.count - shown.length);
  const people =
    rest > 0
      ? `${shown.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`
      : shown.length === 1
        ? shown[0]!
        : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return `${people} reacted ${emoji}`;
}

/**
 * What the composer KEEPS after a submit, in one place because the asymmetry is
 * the whole rule: a success empties the box (the drawer's create composer stays
 * mounted, so without this the sent text sat there), and a FAILURE preserves
 * every character — losing someone's typed comment to a network blink is the
 * worse bug.
 */
export function composerStateAfterSubmit<M>(
  result: { ok: boolean },
  current: { body: string; mentions: M[] },
): { body: string; mentions: M[] } {
  return result.ok ? { body: "", mentions: [] } : current;
}

/** The anchor a plain page gets: itself, if it is commentable. */
export function viewAnchorFor(pathname: string): CommentAnchor | null {
  return isCommentableView(pathname) ? { type: "view", id: pathname } : null;
}

/**
 * Which anchor the comment drawer is pointing at.
 *
 * An ENTITY beats the page it sits on: a creative's detail page anchors to the
 * creative, not to `/library/Some-Name` (which isn't commentable anyway — only
 * nav pages are). Entity registrations carry the pathname they were made on,
 * so a stale one from the page you just left can never leak onto the next.
 * A page with neither — a flow step, the notifications feed — has no anchor,
 * and the drawer's icon is hidden rather than shown broken.
 */
export function resolveCommentAnchor(input: {
  pathname: string;
  entity?: { path: string; anchor: CommentAnchor } | null;
}): CommentAnchor | null {
  if (input.entity && input.entity.path === input.pathname) return input.entity.anchor;
  return viewAnchorFor(input.pathname);
}

/** The query param that tells the drawer to open on one comment. */
export const COMMENT_PARAM = "comment";

/**
 * Threads are FLAT — one level of replies. Replying to a reply re-parents to
 * that thread's ROOT, so `parent_id` always points at a top-level comment and
 * no thread can grow a second level to indent, paginate or collapse.
 */
export function rootParentId(target: { id: string; parentId: string | null }): string {
  return target.parentId ?? target.id;
}

export interface RecipientSplit {
  /** Told "you were mentioned" — category `mention`. */
  mention: string[];
  /** Told "someone replied in a thread you're in" — category `reply`. */
  reply: string[];
  /**
   * Told "someone commented where you have commented" — ANCHOR-FOLLOWING
   * (2026-10). The weakest claim on someone's attention, so it loses every
   * overlap.
   */
  anchorActivity: string[];
}

/**
 * Who hears about one comment, and in which flavour.
 *
 * ONE ROW PER PERSON PER COMMENT, highest claim first:
 * **mention > reply > anchor activity**. Someone mentioned in a comment that
 * also replies to their thread on an anchor they follow gets exactly ONE
 * notification — the mention — and the actor is never told about their own.
 * The priority is the point: a mention is "you specifically", a reply is "your
 * conversation", anchor activity is "somewhere you have been".
 */
export function splitCommentRecipients(input: {
  actorUserId: string;
  /** Explicitly mentioned in THIS comment (from the picker, never parsed). */
  mentioned: readonly string[];
  /**
   * The thread's participants — root author, every replier, and everyone
   * mentioned earlier in it. Empty for a top-level comment, which is why a
   * top-level comment with no mentions notifies nobody *through this bucket*.
   */
  participants: readonly string[];
  /**
   * Everyone who has commented on this ANCHOR before (any thread). Passed only
   * for a TOP-LEVEL comment: a reply already reaches its own thread, and
   * pinging every past commenter on the page for it would be noise.
   */
  anchorParticipants?: readonly string[];
}): RecipientSplit {
  const mention = [...new Set(input.mentioned)].filter(
    (id) => id !== input.actorUserId,
  );
  const taken = new Set([...mention, input.actorUserId]);
  const reply = [...new Set(input.participants)].filter((id) => !taken.has(id));
  for (const id of reply) taken.add(id);
  const anchorActivity = [...new Set(input.anchorParticipants ?? [])].filter(
    (id) => !taken.has(id),
  );
  return { mention, reply, anchorActivity };
}

/**
 * A query string in canonical form, so two spellings of the same view compare
 * equal (`a=1&b=2` and `b=2&a=1` are one view, and `?` prefixes don't matter).
 */
export function normalizeQuery(query: string | null | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const entries = [...params.entries()].filter(([, v]) => v !== "");
  entries.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  return new URLSearchParams(entries).toString();
}

/**
 * Whether to offer "Open this view" on a comment: only when it captured a view
 * AND that view differs from what the reader is currently looking at. Offering
 * it when the two match is noise — the button would do nothing.
 */
export function showViewChip(
  commentQuery: string | null | undefined,
  currentQuery: string | null | undefined,
): boolean {
  const stored = normalizeQuery(commentQuery);
  if (stored === "") return false;
  return stored !== normalizeQuery(currentQuery);
}

/**
 * The URL a comment's deep link lands on: the CURRENT path of the thing it is
 * about (names change — the resolver looks them up at click time), the view it
 * was written under, and `?comment=<id>`, which opens the drawer on that
 * comment and highlights it.
 *
 * A query param rather than a hash: the drawer is a React surface that has to
 * read it (a hash is invisible to the router), and the comment may not be
 * mounted at all until the drawer opens.
 */
export function buildCommentTarget(
  path: string,
  viewQuery: string | null | undefined,
  commentId: string,
): string | null {
  const safe = safeHref(path);
  if (!safe) return null;
  const query = normalizeQuery(viewQuery);
  const [base, existing] = safe.split("?");
  // An anchor's own path may already carry a query (`/budget?month=2026-09`);
  // the captured one wins on conflict, because it is what the commenter saw.
  const merged = new URLSearchParams(existing ?? "");
  for (const [k, v] of new URLSearchParams(query)) merged.set(k, v);
  merged.set(COMMENT_PARAM, commentId);
  return `${base}?${merged.toString()}`;
}

// ── Inline @ mentions ─────────────────────────────────────────────────────

/** Longest @query the inline picker keeps listening to. */
export const MENTION_QUERY_MAX = 40;

export interface MentionQuery {
  /** Index of the "@" that opened the token. */
  start: number;
  /** What has been typed after it, up to the caret. */
  query: string;
}

/**
 * The "@query" the caret is sitting in, if any — what opens the inline picker.
 *
 * The "@" must START the text or follow whitespace. That one rule is what keeps
 * mid-word and email-like text ("salam@urjwan.com") from ever popping the
 * picker. The token ends at whitespace: type a space and you've left it (the
 * picker still inserts full names like "Ann Lee" — filtering on "Ann" finds
 * them).
 */
export function detectMentionQuery(text: string, caret: number): MentionQuery | null {
  if (caret < 1 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query) || query.length > MENTION_QUERY_MAX) return null;
  return { start: at, query };
}

/** Replace the open "@query" with "@Name " and put the caret after it. */
export function insertMentionToken(
  text: string,
  token: MentionQuery,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name} `;
  return {
    text: text.slice(0, token.start) + inserted + text.slice(caret),
    caret: token.start + inserted.length,
  };
}

/** Members matching a picker query — name OR email, case-insensitive. */
export function matchMembers<T extends { name: string; email?: string | null }>(
  members: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...members];
  return members.filter(
    (m) => m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q),
  );
}

/**
 * The picked mentions that SURVIVED editing. Picking someone and then deleting
 * their "@Name" un-mentions them: only a token still present in the final text
 * is sent. The ids still travel explicitly — this filters the picker's own
 * list, it never discovers a mention from the text.
 */
export function activeMentions<T extends { name: string }>(
  body: string,
  picked: readonly T[],
): T[] {
  return picked.filter((m) => body.includes(`@${m.name}`));
}

export interface BodySegment {
  text: string;
  mention: boolean;
}

/**
 * Split a body for rendering so mentioned names can be highlighted.
 *
 * Mentions are STORED explicitly (the picker writes rows; nothing is parsed out
 * of the text), so this is presentation only: it highlights `@Name` where Name
 * is someone actually recorded as mentioned. A typed "@someone" that never went
 * through the picker stays plain text — and notifies nobody, which is the
 * honest rendering of what happened.
 */
export function highlightMentions(
  body: string,
  names: readonly string[],
): BodySegment[] {
  const targets = [...new Set(names.filter((n) => n.trim() !== ""))].sort(
    (a, b) => b.length - a.length, // longest first: "Ann Lee" before "Ann"
  );
  if (targets.length === 0) return [{ text: body, mention: false }];

  const out: BodySegment[] = [];
  let i = 0;
  let plain = "";
  outer: while (i < body.length) {
    if (body[i] === "@") {
      for (const name of targets) {
        if (body.startsWith(name, i + 1)) {
          if (plain) {
            out.push({ text: plain, mention: false });
            plain = "";
          }
          out.push({ text: `@${name}`, mention: true });
          i += name.length + 1;
          continue outer;
        }
      }
    }
    plain += body[i];
    i++;
  }
  if (plain) out.push({ text: plain, mention: false });
  return out;
}
