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

/**
 * Who may delete SOMEONE ELSE'S comment: admins only (F3, user decision
 * 2026-10-24). Authors always delete their own; `users.manage` no longer
 * grants this.
 * The ONE rule — `deleteComment` enforces it and the layout hands it to the
 * panel as `canModerate`, so the menu never offers a delete the server refuses.
 */
export function canModerateComments(user: { role: string }): boolean {
  return user.role === "admin";
}

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
 * REACTIONS — a FIXED set of twelve (user decision, 2026-10-20; it was five),
 * and the SHORT KEY is what is stored.
 *
 * The key is the durable thing: rows in `comment_reactions` carry it, so the
 * keys are effectively schema — the original five (`up` `heart` `party`
 * `laugh` `wow`) keep their exact spelling, and every key fits the column's
 * varchar(16). The emoji is presentation and could change without a
 * migration. ORDER is the picker's order (two rows of six at 375 px).
 * Everything — the picker, the pills, the validator, the notification wording
 * — derives from this array; never re-list the kinds at a consumer. A key
 * retired from here still renders, as its raw key.
 */
export const COMMENT_REACTIONS = [
  { key: "up", emoji: "\u{1F44D}", label: "Thumbs up" },
  { key: "down", emoji: "\u{1F44E}", label: "Thumbs down" },
  { key: "heart", emoji: "\u{2764}\u{FE0F}", label: "Heart" },
  { key: "fire", emoji: "\u{1F525}", label: "Fire" },
  { key: "party", emoji: "\u{1F389}", label: "Party" },
  { key: "laugh", emoji: "\u{1F602}", label: "Laugh" },
  { key: "wow", emoji: "\u{1F62E}", label: "Wow" },
  { key: "sad", emoji: "\u{1F622}", label: "Sad" },
  { key: "pray", emoji: "\u{1F64F}", label: "Thank you" },
  { key: "eyes", emoji: "\u{1F440}", label: "Looking" },
  { key: "check", emoji: "\u{2705}", label: "Done" },
  { key: "hundred", emoji: "\u{1F4AF}", label: "100" },
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

/**
 * The notification dedupe key for a reaction: the author hears about one
 * person's one emoji on one comment ONCE, ever — removing and re-adding stays
 * quiet (user decision, 2026-10-20). Namespaced ("reaction:") because
 * `notifications.dedupe_key` is shared with phase-3 alerts.
 */
export function reactionDedupeKey(commentId: string, actorUserId: string, kind: string): string {
  return `reaction:${commentId}:${actorUserId}:${kind}`;
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

/**
 * Does this keydown SUBMIT the composer? Enter does; Shift+Enter breaks the
 * line; and an Enter that belongs to an input-method editor mid-composition
 * (Japanese, Chinese, Korean…) confirms the IME's candidate and is never ours
 * — `isComposing` is the standard flag, keyCode 229 what Safari reports for
 * the keydown that ends a composition (2026-10).
 */
export function enterSubmits(e: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}): boolean {
  if (e.isComposing || e.keyCode === 229) return false;
  return e.key === "Enter" && !e.shiftKey;
}

/** Is a keydown part of an IME composition (so no shortcut may act on it)? */
export function isImeKeydown(e: { isComposing: boolean; keyCode: number }): boolean {
  return e.isComposing || e.keyCode === 229;
}

/**
 * The panel's local rows for your own posts (2026-10-20 review). A row is
 * `pending` while on its way ("Sending…"); once the server has it, it takes
 * the stored id and stays — as sent — until a SUCCESSFUL load shows the stored
 * copy. A failed reload must never make a sent comment vanish. Both steps are
 * pure so the rule is pinned.
 */
export function markPostSent<T extends { id: string; pending?: boolean }>(
  rows: readonly T[],
  tempId: string,
  storedId: string,
): T[] {
  return rows.map((r) => (r.id === tempId ? { ...r, id: storedId, pending: false } : r));
}

/** After a successful load: drop the sent rows the stored thread now shows. */
export function settleSentPosts<T extends { id: string; pending?: boolean }>(
  rows: readonly T[],
  storedIds: ReadonlySet<string>,
): T[] {
  return rows.filter((r) => r.pending === true || !storedIds.has(r.id));
}

// ── Reading a thread: "New", collapsed replies (2026-10-20) ─────────────────

/**
 * Which comments are NEW to this reader: posted by SOMEONE ELSE after
 * `since` (where they last left this thread — `comment_reads`). Your own are
 * never new; a deleted one isn't news; a first visit (`since` null) has
 * nothing new — there is no baseline to be new against.
 */
export function newCommentIds(
  comments: ReadonlyArray<{
    id: string;
    authorUserId: string | null;
    createdAt: Date;
    deletedAt: Date | null;
    pending?: boolean;
  }>,
  since: Date | null,
  currentUserId: string | null,
): Set<string> {
  const out = new Set<string>();
  if (!since) return out;
  for (const c of comments) {
    if (c.pending || c.deletedAt !== null) continue;
    if (c.authorUserId !== null && c.authorUserId === currentUserId) continue;
    if (c.createdAt.getTime() > since.getTime()) out.add(c.id);
  }
  return out;
}

/** How many of a thread's latest replies stay visible when it collapses. */
export const REPLIES_VISIBLE = 2;

/**
 * A long thread COLLAPSES: more than `REPLIES_VISIBLE` replies show the latest
 * ones and a "Show N earlier replies" control — unless the reader opened it,
 * or the hidden range holds something they must see (the deep-linked reply,
 * a "New" one), which forces it open.
 */
export function collapseReplies<T extends { id: string }>(
  replies: readonly T[],
  opts: { expanded: boolean; mustShow: ReadonlySet<string> },
): { hidden: number; shown: T[] } {
  if (opts.expanded || replies.length <= REPLIES_VISIBLE) {
    return { hidden: 0, shown: [...replies] };
  }
  const cut = replies.length - REPLIES_VISIBLE;
  if (replies.slice(0, cut).some((r) => opts.mustShow.has(r.id))) {
    return { hidden: 0, shown: [...replies] };
  }
  return { hidden: cut, shown: replies.slice(cut) };
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
 * A query string minus `?comment=` — what a comment may STORE as its view
 * (2026-10). The param is navigation (a deep link's "open the panel on this
 * one"), not part of what the reader was looking at: captured from
 * `window.location.search` after a deep link, it made the NEW comment's view
 * re-highlight the OLD one. Everything else is kept verbatim, in order — the
 * stored view is what the commenter saw, byte for byte.
 */
export function stripCommentParam(query: string | null | undefined): string {
  if (!query) return "";
  const q = query.startsWith("?") ? query.slice(1) : query;
  return q
    .split("&")
    .filter((part) => {
      if (part === "") return false;
      const raw = part.split("=")[0]!.replace(/\+/g, " ");
      let key = raw;
      try {
        key = decodeURIComponent(raw);
      } catch {
        /* a malformed escape: compare the raw key */
      }
      return key !== COMMENT_PARAM;
    })
    .join("&");
}

export type DeepLinkStep =
  | { kind: "wait" }
  | { kind: "highlight"; id: string }
  | { kind: "reload" };

/**
 * What the panel does about a deep-linked comment (`?comment=<id>`), given the
 * thread it has loaded (2026-10).
 *
 * The id used to be written straight into the highlight, and the panel's own
 * "new conversation" reset then wiped it — when the panel mounted after being
 * opened, and again when an entity page registered its anchor (null →
 * creative). You arrived from a notification and landed at the bottom with
 * nothing highlighted. Now the id WAITS, untouched by those resets, until a
 * loaded thread contains it; then it becomes the highlight. If the thread on
 * screen doesn't have it — the comment is newer than the last load (a
 * notification for the page you're already on) — the panel reloads ONCE.
 * Comment ids are unique, so it can only ever match its own thread.
 */
export function deepLinkStep(input: {
  deepLinkId: string | null;
  /** The ids in the loaded thread; null while nothing is loaded. */
  loadedIds: readonly string[] | null;
  /** The deep link the panel already reloaded once for. */
  reloadedFor: string | null;
}): DeepLinkStep {
  const { deepLinkId, loadedIds, reloadedFor } = input;
  if (!deepLinkId || loadedIds === null) return { kind: "wait" };
  if (loadedIds.includes(deepLinkId)) return { kind: "highlight", id: deepLinkId };
  if (reloadedFor !== deepLinkId) return { kind: "reload" };
  return { kind: "wait" };
}

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
  /** Mentioned in THIS comment — explicit ids from the composer; the server never parses the body. */
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
  // `?comment=` is navigation, not a view (2026-10): two views that differ
  // only by it are the same view.
  const entries = [...params.entries()].filter(([k, v]) => v !== "" && k !== COMMENT_PARAM);
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
 * picker.
 *
 * A NAME HAS SPACES (2026-10). The token used to end at the first space, so
 * typing a full name — "@Abdulsalam Ghazal" — closed the picker halfway, the
 * name went in as plain text, and NOBODY was notified. Now, given the member
 * list, the token runs on through spaces for as long as at least one member
 * still matches it, and closes cleanly the moment nobody does ("@Ali hello
 * there"). A new line always ends it, a space straight after the "@" never
 * starts one, and `MENTION_QUERY_MAX` bounds it. `members === null` means the
 * list is still LOADING: the token stays open (the picker says "Loading…") and
 * the caller re-reads it when the list lands — a pasted "@Ann Lee" must not
 * close before anyone could know. With no list at all (`undefined`) a space
 * ends the token, as before. The server still receives explicit ids only;
 * see `resolveComposerMentions` for what the composer recognises.
 */
export function detectMentionQuery(
  text: string,
  caret: number,
  members?: ReadonlyArray<{ name: string; email?: string | null }> | null,
): MentionQuery | null {
  if (caret < 1 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (query.length > MENTION_QUERY_MAX || /[\r\n]/.test(query)) return null;
  if (/\s/.test(query)) {
    if (/^\s/.test(query) || members === undefined) return null;
    if (members !== null && matchMembers(members, query).length === 0) return null;
  }
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

/** A character that continues a NAME — any script's letters, marks, digits. */
const NAME_CHAR = /[\p{L}\p{M}\p{N}_]/u;

/** The full character ending just before `index` (a surrogate pair is one). */
function charBefore(text: string, index: number): string {
  if (index <= 0) return "";
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) return text.slice(index - 2, index);
  return text[index - 1]!;
}

/** The full character starting at `index`, or "" past the end. */
function charAt(text: string, index: number): string {
  const cp = text.codePointAt(index);
  return cp === undefined ? "" : String.fromCodePoint(cp);
}

export interface MentionSpan {
  /** Index of the "@". */
  start: number;
  /** Index just past the name. */
  end: number;
  name: string;
}

/**
 * Every "@Name" in `text` for one of `names` — ONE left-to-right pass, the
 * LONGEST name winning at each "@", and a mention must be the WHOLE name
 * (2026-10). Both edges are checked:
 *
 *  - after the name, no character that continues a word in any script — so
 *    "@Alice" is not "@Ali", and "@سارةو" is not "@سارة";
 *  - before the "@", no word character, "/" or "@" — so an email or a URL
 *    path ("x.com/@Ali") is never a mention.
 *
 * It used to be `body.includes("@" + name)`, so with "Ali" and "Ali Hassan"
 * both picked, deleting "@Ali" still left Ali "active" inside "@Ali Hassan" —
 * and notified him. Shared by `activeMentions`, `highlightMentions` and the
 * renderer's mention marking, so the three can never disagree.
 */
export function findMentions(text: string, names: readonly string[]): MentionSpan[] {
  const targets = [...new Set(names.filter((n) => n.trim() !== ""))].sort(
    (a, b) => b.length - a.length, // "Ann Lee" before "Ann"
  );
  const out: MentionSpan[] = [];
  if (targets.length === 0) return out;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "@") continue;
    const prev = charBefore(text, i);
    if (prev !== "" && (NAME_CHAR.test(prev) || prev === "/" || prev === "@")) continue;
    for (const name of targets) {
      if (!text.startsWith(name, i + 1)) continue;
      const end = i + 1 + name.length;
      if (NAME_CHAR.test(charAt(text, end))) continue;
      out.push({ start: i, end, name });
      i = end - 1;
      break;
    }
  }
  return out;
}

/**
 * The picked mentions that SURVIVED editing. Picking someone and then deleting
 * their "@Name" un-mentions them: only a WHOLE "@Name" still present in the
 * final text counts (`findMentions` — a longer name never keeps a shorter one
 * alive). The ids still travel explicitly — this filters the picker's own list,
 * it never discovers a mention from the text.
 */
export function activeMentions<T extends { name: string }>(
  body: string,
  picked: readonly T[],
): T[] {
  const present = new Set(
    findMentions(
      body,
      picked.map((m) => m.name),
    ).map((s) => s.name),
  );
  return picked.filter((m) => present.has(m.name));
}

/**
 * WHO A SUBMIT MENTIONS, as the composer sees it (user decision, 2026-10-20).
 *
 * Every whole "@Name" in the text (`findMentions`, matched against the picked
 * names AND the member list together, so the longest name always wins — a
 * picked "Ali" never rides along inside "@Ali Hassan") resolves to:
 *  - the member(s) PICKED with that name, if any — an explicit pick wins;
 *  - otherwise the ONE member whose name it is EXACTLY (case-sensitive, the
 *    whole name) — a typed or pasted "@Ali Hassan" counts, so "Notifying Ali
 *    Hassan" shows before sending;
 *  - otherwise nobody: a name two members share is never guessed — the
 *    picker is how you choose between them.
 * In order of appearance, each person once. With no member list (`null`) only
 * the picks count. The SERVER is unchanged: it receives these explicit ids and
 * refuses a non-member out loud — nothing is parsed from the body there.
 */
export function resolveComposerMentions<T extends { id: string; name: string }>(
  body: string,
  picked: readonly T[],
  members: readonly T[] | null,
): T[] {
  const names = [...picked.map((m) => m.name), ...(members ?? []).map((m) => m.name)];
  const out: T[] = [];
  const seen = new Set<string>();
  const add = (m: T) => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    out.push(m);
  };
  for (const span of findMentions(body, names)) {
    const chosen = picked.filter((m) => m.name === span.name);
    if (chosen.length > 0) {
      chosen.forEach(add);
      continue;
    }
    const named = (members ?? []).filter((m) => m.name === span.name);
    if (named.length === 1) add(named[0]!);
  }
  return out;
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
  const spans = findMentions(body, names);
  if (spans.length === 0) return [{ text: body, mention: false }];
  const out: BodySegment[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.start > at) out.push({ text: body.slice(at, span.start), mention: false });
    out.push({ text: body.slice(span.start, span.end), mention: true });
    at = span.end;
  }
  if (at < body.length) out.push({ text: body.slice(at), mention: false });
  return out;
}
