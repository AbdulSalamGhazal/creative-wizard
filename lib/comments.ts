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
}

/**
 * Who hears about one comment, and in which flavour.
 *
 * MENTION WINS: someone both mentioned in this comment and party to the thread
 * gets exactly one notification, the mention. Nobody ever gets two rows for one
 * comment, and the actor is never told about their own.
 */
export function splitCommentRecipients(input: {
  actorUserId: string;
  /** Explicitly mentioned in THIS comment (from the picker, never parsed). */
  mentioned: readonly string[];
  /**
   * The thread's participants — root author, every replier, and everyone
   * mentioned earlier in it. Empty for a top-level comment, which is why a
   * top-level comment with no mentions notifies nobody.
   */
  participants: readonly string[];
}): RecipientSplit {
  const mention = [...new Set(input.mentioned)].filter(
    (id) => id !== input.actorUserId,
  );
  const taken = new Set([...mention, input.actorUserId]);
  const reply = [...new Set(input.participants)].filter((id) => !taken.has(id));
  return { mention, reply };
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
