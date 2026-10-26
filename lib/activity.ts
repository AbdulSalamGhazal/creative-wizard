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
  view: "Pages",
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
  view: "Retired page",
};

/** The feed's URL state, as the validator yields it and the page passes it on. */
export interface ActivityParams {
  who: ActivityWho;
  types: CommentAnchorType[];
  q: string;
  page: number;
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
  return params.toString();
}

export function activityHref(p: ActivityParams): string {
  const query = activityQuery(p);
  return query ? `${ACTIVITY_PATH}?${query}` : ACTIVITY_PATH;
}

/** Is anything narrowing the feed beyond Everyone/Mine? Decides the empty copy. */
export function isActivityFiltered(p: ActivityParams): boolean {
  return p.types.length > 0 || p.q !== "";
}
