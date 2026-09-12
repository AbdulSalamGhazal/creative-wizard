import { safeHref } from "@/lib/notifications";

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
 * The aggregate pages that accept a "view" comment — an explicit ALLOW-LIST,
 * because `anchor_id` for these is a pathname and an unchecked pathname is an
 * open door (a comment anchored to an arbitrary string, and a deep link to
 * wherever it says).
 *
 * `/trends` itself is a redirect stub, so the Changes page it lands on is what
 * is listed.
 */
export const COMMENTABLE_VIEWS = [
  { path: "/", label: "Dashboard" },
  { path: "/summary", label: "Ads" },
  { path: "/funnel", label: "Funnel" },
  { path: "/campaigns", label: "Campaigns" },
  { path: "/trends/over-time", label: "Trends — Changes" },
  { path: "/trends/by-angle", label: "Trends — Angles" },
  { path: "/compare", label: "Compare" },
  { path: "/budget/pacing", label: "Pacing" },
  { path: "/store/reconciliation", label: "Reconciliation" },
] as const;

export type CommentableViewPath = (typeof COMMENTABLE_VIEWS)[number]["path"];

export function isCommentableView(path: string): path is CommentableViewPath {
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
 * was written under, and the anchor that scrolls it into sight.
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
  const qs = merged.toString();
  return `${base}${qs ? `?${qs}` : ""}#comment-${commentId}`;
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
