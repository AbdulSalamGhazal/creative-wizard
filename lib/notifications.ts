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
 * The category a stored `type` belongs to. Rows outlive catalog entries — a
 * retired event type keeps its history — so an unknown type reads as "system"
 * rather than breaking the page's filter.
 */
export function categoryForType(type: string): NotificationCategory {
  const routed = eventMeta(type);
  if (routed) return routed.category;
  return DIRECT_CATEGORY[type as DirectEventType] ?? "system";
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
