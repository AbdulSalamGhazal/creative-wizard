/**
 * Notifications — the vocabulary, and the single source every surface derives
 * from (the page's filter chips, the routing config's rows, the producers).
 *
 * PHASE 1 is the spine: per-user in-app notifications, a bell, a page, and
 * centrally-configured routing. Comments/mentions (phase 2), alert evaluators
 * and reminders (phase 3) and email (phase 4) are not built — but the frame is
 * theirs too: all five categories exist from day one, and `notifications
 * .dedupe_key` is reserved so a phase-3 evaluator can upsert "still over
 * budget" instead of filing a duplicate every hour.
 */

/**
 * Every category a notification can belong to. Phase 1 only PRODUCES "system",
 * and the page still renders all five chips: the shape of the system is the
 * thing being agreed on here, not the current output.
 */
export const NOTIFICATION_CATEGORIES = [
  "system",
  "mention",
  "reply",
  "alert",
  "reminder",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  system: "System",
  mention: "Mentions",
  reply: "Replies",
  alert: "Alerts",
  reminder: "Reminders",
};

export function isNotificationCategory(value: string): value is NotificationCategory {
  return (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

interface EventTypeEntry {
  key: string;
  label: string;
  category: NotificationCategory;
  /** Shown under the label in the routing config — what firing it means. */
  description: string;
}

/**
 * The ROUTABLE event catalog. A row in `notification_routes` says "this person
 * receives this event in this brand"; no rows means the event notifies nobody,
 * which is the deliberate default — a notification system that starts loud gets
 * switched off.
 *
 * Adding a phase-3 alert later is ONE entry here plus one `notifyRoutes` call
 * at the point it happens; the config tab grows a row on its own.
 */
export const EVENT_TYPES = [
  {
    key: "upload.committed",
    label: "Ads upload committed",
    category: "system",
    description: "A performance-data upload finished importing.",
  },
  {
    key: "store.upload_committed",
    label: "Store upload committed",
    category: "system",
    description: "A Salla order file finished importing.",
  },
  {
    key: "upload.rolled_back",
    label: "Ads upload rolled back",
    category: "system",
    description: "A batch was rolled back inside its 24-hour window.",
  },
  {
    key: "budget.plan_saved",
    label: "Budget plan saved",
    category: "system",
    description: "A month's budget plan was edited and saved.",
  },
  {
    key: "budget.plan_restored",
    label: "Budget plan restored",
    category: "system",
    description: "A month's plan was restored from an earlier revision.",
  },
  {
    key: "exclusion.rule_created",
    label: "Exclusion rule created",
    category: "system",
    description: "A new rule started excluding records from aggregates.",
  },
  {
    key: "exclusion.rule_deactivated",
    label: "Exclusion rule deactivated",
    category: "system",
    description: "A rule was switched off and its records returned to aggregates.",
  },
] as const satisfies readonly EventTypeEntry[];

export type EventType = (typeof EVENT_TYPES)[number]["key"];

/** Derived — never hand-list the keys. */
export const EVENT_TYPE_KEYS: readonly EventType[] = EVENT_TYPES.map((e) => e.key);

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPE_KEYS as readonly string[]).includes(value);
}

export function eventMeta(key: string): EventTypeEntry | null {
  return EVENT_TYPES.find((e) => e.key === key) ?? null;
}

/**
 * DIRECT events bypass routing entirely: they have exactly one natural
 * recipient — the person they happened to — so there is nothing to configure.
 * `user.brand_granted` is the phase-1 example, stamped to the GRANTED brand so
 * it appears when the recipient is looking at that brand.
 */
export const DIRECT_EVENT_TYPES = {
  BRAND_GRANTED: "user.brand_granted",
} as const;

export type DirectEventType =
  (typeof DIRECT_EVENT_TYPES)[keyof typeof DIRECT_EVENT_TYPES];

const DIRECT_CATEGORY: Record<DirectEventType, NotificationCategory> = {
  "user.brand_granted": "system",
};

/**
 * COMMENT events (phase 2). Like the direct ones they bypass routing — a
 * comment reaches you because it mentioned you or replied to you, never
 * because of a route — so they are not in `EVENT_TYPES` either. They ARE in
 * the category map, because the page's chip, the bell and the arrival toaster
 * all derive a category from the stored type, and a mention that reads
 * "System" is the same bug in three places.
 */
export const COMMENT_EVENT_TYPES = {
  MENTION: "comment.mention",
  REPLY: "comment.reply",
  /**
   * ANCHOR-FOLLOWING (2026-10, user decision): a new TOP-LEVEL comment tells
   * everyone who has commented on that anchor before. Category `reply` — it is
   * conversation, not a system event — but its own TYPE, so the wording can
   * say what actually happened ("…where you commented") and the page can group
   * it.
   */
  ANCHOR_ACTIVITY: "comment.anchor_activity",
  /**
   * A REACTION on your comment (2026-10, user decision: "notify like a reply").
   * Category `reply` — somebody responded to you, directly and by name; it is
   * conversation, not a system event. On ADD only: removing a reaction retracts
   * nothing, because you cannot un-tell someone.
   */
  REACTION: "comment.reaction",
} as const;

export type CommentEventType =
  (typeof COMMENT_EVENT_TYPES)[keyof typeof COMMENT_EVENT_TYPES];

const COMMENT_CATEGORY: Record<CommentEventType, NotificationCategory> = {
  "comment.mention": "mention",
  "comment.reply": "reply",
  "comment.anchor_activity": "reply",
  "comment.reaction": "reply",
};

/**
 * The category a stored `type` belongs to. Rows outlive catalog entries — a
 * retired event type keeps its history — so an unknown type reads as "system"
 * rather than breaking the page's filter.
 */
export function categoryForType(type: string): NotificationCategory {
  const routed = eventMeta(type);
  if (routed) return routed.category;
  return (
    COMMENT_CATEGORY[type as CommentEventType] ??
    DIRECT_CATEGORY[type as DirectEventType] ??
    "system"
  );
}

/** Rows per page on /notifications. Server-paginated — never an unbounded read. */
export const NOTIFICATIONS_PAGE_SIZE = 50;

/** How many the bell's popover shows. */
export const BELL_RECENT_LIMIT = 10;

/** Above this the badge stops counting and says "9+". */
export const BADGE_CAP = 9;

/**
 * How often the bell re-checks its count while the tab is focused. ONE
 * constant, deliberately: the hosting plan (not the UI) decides what's
 * affordable, and 30s is the free-tier setting — drop it to 10s on a paid one
 * and every surface follows.
 */
export const POLL_MS = 30_000;

/** The badge's text: nothing at zero, the number, or the capped form. */
export function badgeCount(unread: number): string {
  if (!Number.isFinite(unread) || unread <= 0) return "";
  return unread > BADGE_CAP ? `${BADGE_CAP}+` : String(Math.floor(unread));
}

/**
 * A notification's link is optional, and a stored one is only followed when it
 * is an in-app path. Anything else (an absolute URL, a protocol-relative one,
 * or junk) is dropped rather than navigated to — the href is data, and the
 * bell must never become an open redirect.
 */
export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  return href;
}

// ── Arrival toasts (2026-09) ─────────────────────────────────────────────────
// Three escalations turn a quiet badge into something you actually notice: a
// toast when something arrives while you are looking at the app, an unread
// count in the TAB TITLE, and one brief shake of the bell. All three read the
// SAME poll the bell already runs — no second timer, no second endpoint.

/**
 * Whose arrivals interrupt you. Per user, global across brands (migration
 * 0050), default `personal` — a system feed that toasts everything trains
 * people to dismiss without reading, which is the failure mode this setting
 * exists to avoid.
 *
 * `off` silences the TOAST ONLY: the badge, the tab title and the bell keep
 * working, because not being interrupted is different from not being told.
 */
export const TOAST_SCOPES = ["personal", "all", "off"] as const;
export type ToastScope = (typeof TOAST_SCOPES)[number];

export const TOAST_SCOPE_LABEL: Record<ToastScope, string> = {
  personal: "Personal only",
  all: "Everything",
  off: "Off",
};

/** What each option means, for the menu's second line. */
export const TOAST_SCOPE_HINT: Record<ToastScope, string> = {
  personal: "Mentions, replies and anything addressed to you",
  all: "Every notification you receive",
  off: "Badge and bell only — never a toast",
};

export const DEFAULT_TOAST_SCOPE: ToastScope = "personal";

export function isToastScope(value: unknown): value is ToastScope {
  return typeof value === "string" && (TOAST_SCOPES as readonly string[]).includes(value);
}

/** A stored value that predates (or outlives) the vocabulary reads as the default. */
export function toToastScope(value: unknown): ToastScope {
  return isToastScope(value) ? value : DEFAULT_TOAST_SCOPE;
}

/** The categories that are personal BY DEFINITION — somebody addressed you. */
const PERSONAL_CATEGORIES: readonly NotificationCategory[] = ["mention", "reply"];

/**
 * "Personal" — the one definition, derived rather than listed twice: a mention
 * or a reply (somebody wrote to you), or a DIRECT event, which has exactly one
 * natural recipient and is therefore about you by construction
 * (`user.brand_granted` today). Everything else — an upload finishing, a plan
 * saved — went to a routing list, not to you.
 */
export function isPersonalNotification(item: {
  category?: string | null;
  type?: string | null;
}): boolean {
  const category = item.category ?? (item.type ? categoryForType(item.type) : null);
  if (category && (PERSONAL_CATEGORIES as readonly string[]).includes(category)) {
    return true;
  }
  const type = item.type;
  if (!type) return false;
  return Object.values(DIRECT_EVENT_TYPES).includes(type as DirectEventType);
}

/** Does this arrival interrupt, under the user's setting? */
export function shouldToast(
  item: { category?: string | null; type?: string | null },
  scope: ToastScope,
): boolean {
  if (scope === "off") return false;
  if (scope === "all") return true;
  return isPersonalNotification(item);
}

/** More new arrivals than this in one poll collapse into ONE summary toast. */
export const TOAST_BURST_LIMIT = 3;

export interface ToastableItem {
  id: string;
  category?: string | null;
  type?: string | null;
  read?: boolean;
}

/**
 * The arrivals a poll should toast, given what was toasted last time.
 *
 * Rules, all deliberate:
 *  · `lastToastedId === null` is a FIRST LOAD — nothing toasts. Opening the
 *    app is not an event; only things that arrive while it is open are.
 *  · items are newest-first (the feed's order), so everything ahead of the
 *    pointer is new. A pointer that is no longer in the window (more arrived
 *    than the feed returns, or it was archived) means everything shown is
 *    newer than it — the burst rule below keeps that to one toast.
 *  · an item already READ elsewhere never toasts.
 */
export function newArrivals(
  items: readonly ToastableItem[],
  lastToastedId: string | null,
): ToastableItem[] {
  if (items.length === 0) return [];
  if (lastToastedId === null) return [];
  const at = items.findIndex((i) => i.id === lastToastedId);
  const fresh = at === -1 ? [...items] : items.slice(0, at);
  return fresh.filter((i) => i.read !== true);
}

export type ToastPlan =
  | { kind: "none" }
  | { kind: "items"; items: ToastableItem[] }
  | { kind: "summary"; count: number };

/**
 * What to show for one poll: nothing, a toast per arrival, or — past
 * `TOAST_BURST_LIMIT` — one summary. A burst is usually a batch job finishing;
 * six stacked toasts is noise, and "6 new notifications" is the same
 * information in one line.
 */
export function toastPlan(
  items: readonly ToastableItem[],
  lastToastedId: string | null,
  scope: ToastScope,
): ToastPlan {
  const fresh = newArrivals(items, lastToastedId).filter((i) => shouldToast(i, scope));
  if (fresh.length === 0) return { kind: "none" };
  if (fresh.length > TOAST_BURST_LIMIT) return { kind: "summary", count: fresh.length };
  // Oldest first, so a stack reads top-down in the order things happened.
  return { kind: "items", items: [...fresh].reverse() };
}

/** "4 new notifications" — the summary toast's line. */
export function burstSummary(count: number): string {
  return `${count} new notification${count === 1 ? "" : "s"}`;
}

/** Per-brand, per-browser pointer: the newest id this browser has toasted. */
export function toastedStorageKey(accountId: string): string {
  return `cw-toasted:${accountId}`;
}

/**
 * The document title with the unread count in front — "(3) Ads", capped like
 * the badge ("9+"). Any existing prefix is stripped first, so re-applying
 * after a route change can never stack them ("(3) (2) Ads").
 */
export function titleWithUnread(title: string, unread: number): string {
  const base = stripUnreadPrefix(title);
  const badge = badgeCount(unread);
  return badge ? `(${badge}) ${base}` : base;
}

/** The title without its "(N) " prefix — the inverse, so the pair is testable. */
export function stripUnreadPrefix(title: string): string {
  return title.replace(/^\(\d+\+?\)\s+/, "");
}

// ── The /notifications page's reading aids (2026-10) ────────────────────────
// A feed is only useful if it can be SCANNED. Three pure helpers do that work
// — day groups, a burst collapse, and the anchor key both depend on — so the
// page stays a renderer and the rules are testable without a DOM.

/** A row's day, in UTC — the house's date discipline, no local-time drift. */
export function utcDay(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * "Today" · "Yesterday" · "3 Oct 2026". Relative to `todayIso` so the caller
 * owns the clock (and a test can fix it).
 */
export function dayGroupLabel(day: string, todayIso: string): string {
  if (day === todayIso) return "Today";
  const yesterday = new Date(`${todayIso}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return "Yesterday";
  // en-US, the app's pinned locale (same as `monthLabel`) — one date dialect.
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * What a notification is ABOUT, for grouping: the entity it was stamped with.
 * Comment notifications stamp the ANCHOR (the creative/campaign/view the
 * conversation hangs on), not the individual comment — that is what makes "5
 * updates on «Hero v2»" possible at all. A row with no entity never groups.
 */
export function anchorKeyOf(row: {
  entityType: string | null;
  entityId: string | null;
}): string | null {
  if (!row.entityType || !row.entityId) return null;
  return `${row.entityType}:${row.entityId}`;
}

/** Consecutive same-anchor rows from this many upwards collapse into one. */
export const BURST_COLLAPSE_MIN = 2;

export interface NotificationGroupItem<T> {
  /** Stable key for React, and the id a group's actions act through. */
  key: string;
  /** The rows this item stands for — one, or the whole collapsed run. */
  rows: T[];
  /** True when `rows` is a collapsed burst rather than a single row. */
  collapsed: boolean;
}

export interface NotificationDayGroup<T> {
  day: string;
  label: string;
  items: Array<NotificationGroupItem<T>>;
}

/**
 * Group a page of notifications into DAYS, collapsing consecutive runs that
 * share an anchor.
 *
 * Deliberate: runs must be CONSECUTIVE (an unrelated row between two updates
 * breaks the run — the feed stays chronological, which is the only ordering a
 * reader can trust) and never cross a day boundary (yesterday's five and
 * today's one are not "six today"). A single row is never wrapped, so nothing
 * hides behind a disclosure that didn't need one.
 */
export function groupNotifications<
  T extends { id: string; createdAt: Date | string; entityType: string | null; entityId: string | null },
>(rows: readonly T[], todayIso: string): Array<NotificationDayGroup<T>> {
  const days: Array<NotificationDayGroup<T>> = [];
  for (const row of rows) {
    const day = utcDay(row.createdAt);
    let group = days.at(-1);
    if (!group || group.day !== day) {
      group = { day, label: dayGroupLabel(day, todayIso), items: [] };
      days.push(group);
    }
    const key = anchorKeyOf(row);
    const last = group.items.at(-1);
    const lastKey = last ? anchorKeyOf(last.rows[0]!) : null;
    if (key !== null && last && lastKey === key) {
      last.rows.push(row);
      last.collapsed = last.rows.length >= BURST_COLLAPSE_MIN;
      continue;
    }
    group.items.push({ key: row.id, rows: [row], collapsed: false });
  }
  return days;
}

/** "5 updates on Hero v2" — the collapsed row's line. */
export function burstLabel(count: number, anchorLabel: string | null): string {
  const what = anchorLabel ? ` on ${anchorLabel}` : "";
  return `${count} update${count === 1 ? "" : "s"}${what}`;
}

/**
 * The anchor's name for a collapsed burst, read back out of the TITLE.
 *
 * `notifications` stores no anchor label, and resolving one per group would be
 * a query per distinct anchor for a cosmetic line — so this reads the title
 * the producer wrote, and ONLY for the comment family, whose wording this
 * codebase owns ("X mentioned you on «label»", "X commented on «label» — where
 * you commented"). Anything else returns null and the burst simply says "5
 * updates", which is still true. It is deliberately conservative: a title that
 * doesn't match the shape names nothing rather than guessing.
 */
export function anchorLabelFromTitle(
  title: string,
  type: string,
): string | null {
  if (!Object.values(COMMENT_EVENT_TYPES).includes(type as CommentEventType)) {
    return null;
  }
  const at = title.lastIndexOf(" on ");
  if (at === -1) return null;
  const tail = title.slice(at + 4).split(" — ")[0]!.trim();
  return tail === "" ? null : tail;
}
