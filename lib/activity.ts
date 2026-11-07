import { type CommentAnchorType } from "@/lib/comments";

/**
 * The Activity feed (/activity, 2026-10) — the pure layer.
 *
 * A PLAIN module on purpose: the SERVER page and the CLIENT feed both read
 * these values, and a value exported from a "use client" file is a
 * client-reference proxy on the server (how /campaigns once shipped broken;
 * `app/rsc-boundary.test.ts`). What both sides share lives here.
 */

export const ACTIVITY_PATH = "/activity";

/**
 * The feed's name (2026-11-07). It was "Activity" until each entity got an
 * Activity of its own (its history, in the rail); the brand-wide list of
 * comments is "All comments" so the two never share a word. The ROUTE stays
 * `/activity` so every stored link keeps working.
 */
export const ALL_COMMENTS_TITLE = "All comments";

/** Whose comments the feed shows. The URL carries `who=me`; absent = everyone. */
export const ACTIVITY_WHO = ["all", "me"] as const;
export type ActivityWho = (typeof ACTIVITY_WHO)[number];

export const ACTIVITY_WHO_LABEL: Record<ActivityWho, string> = {
  all: "Everyone",
  me: "Mine",
};

/**
 * The type chips' wording — a FULL record, so a fifth anchor kind fails
 * compilation until it is labelled here (the audit page's pattern).
 */
export const ANCHOR_TYPE_LABEL: Record<CommentAnchorType, string> = {
  creative: "Creatives",
  campaign: "Campaigns",
  budget_month: "Budget",
  ps_version: "Price versions",
  view: "Old page comments",
};

/**
 * What a run's header says when the thing it was about is GONE: a creative or
 * campaign hard-deleted (comments survive — `anchor_id` has no FK), or a page
 * the nav no longer offers. A budget month always labels; its entry exists so
 * the record stays exhaustive.
 */
export const ANCHOR_FALLBACK_LABEL: Record<CommentAnchorType, string> = {
  creative: "Deleted creative",
  campaign: "Deleted campaign",
  budget_month: "Budget month",
  ps_version: "Deleted price version",
  view: "Retired page",
};

/** The feed's URL state, as the validator yields it and the page passes it on. */
export interface ActivityParams {
  who: ActivityWho;
  types: CommentAnchorType[];
  q: string;
  page: number;
  /**
   * One comment on its own (`?comment=<id>`) — where a link to a comment that
   * has no page any more lands: a retired page comment, or one on a deleted
   * creative or campaign. The other filters are ignored while it is set.
   */
  comment: string | null;
}

/**
 * The query string for a set of params. Only what differs from the default
 * is written — `who` only for Mine, `page` only past 1 — so the default view
 * is the bare path and two spellings of it never diverge.
 */
export function activityQuery(p: ActivityParams): string {
  const params = new URLSearchParams();
  if (p.who !== "all") params.set("who", p.who);
  if (p.types.length > 0) params.set("types", p.types.join(","));
  if (p.q) params.set("q", p.q);
  if (p.page > 1) params.set("page", String(p.page));
  if (p.comment) params.set("comment", p.comment);
  return params.toString();
}

export function activityHref(p: ActivityParams): string {
  const query = activityQuery(p);
  return query ? `${ACTIVITY_PATH}?${query}` : ACTIVITY_PATH;
}

/** One comment, on its own, in the feed. */
export function activityCommentHref(id: string): string {
  return `${ACTIVITY_PATH}?${new URLSearchParams({ comment: id })}`;
}

/** Is anything narrowing the feed beyond Everyone/Mine? Decides the empty copy. */
export function isActivityFiltered(p: ActivityParams): boolean {
  return p.types.length > 0 || p.q !== "";
}
