"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dateTimeLabel, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BADGE_CAP,
  DEFAULT_TOAST_SCOPE,
  POLL_MS,
  announceNotificationsChanged,
  badgeCount,
  bellSeenPlan,
  burstSummary,
  onNotificationsChanged,
  onToastScopeChanged,
  safeHref,
  stripUnreadPrefix,
  titleWithUnread,
  toastPlan,
  toastedStorageKey,
  type ToastScope,
} from "@/lib/notifications";
import { markNotificationRead, markNotificationsRead } from "@/app/actions/notifications";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { NotificationAvatar } from "@/components/notifications/notification-avatar";

interface FeedItem {
  id: string;
  /** The stored event type — `toastPlan` needs it to spot a DIRECT event. */
  type: string;
  category: string;
  /** An English template; user-supplied names inside are Unicode-ISOLATED. */
  title: string;
  /** The comment it's about (a preview), when there is one. */
  body: string | null;
  href: string | null;
  actor: string | null;
  actorAvatarUrl: string | null;
  createdAt: string;
  read: boolean;
}

/**
 * The toasted-pointer store: the newest id this BROWSER has already toasted
 * for this PERSON in this brand (per user since 2026-10-20 — two people
 * sharing a browser used to inherit each other's pointer). Per the house
 * storage discipline every access is guarded — a private window, blocked site
 * data or a thumbnail capture can throw or return nothing, and the bell must
 * work regardless (it just falls back to "first load", which toasts nothing).
 */
function readToasted(userId: string, accountId: string): string | null {
  try {
    return window.localStorage.getItem(toastedStorageKey(userId, accountId));
  } catch {
    return null;
  }
}

function writeToasted(userId: string, accountId: string, id: string): void {
  try {
    window.localStorage.setItem(toastedStorageKey(userId, accountId), id);
  } catch {
    /* storage unavailable — the session simply re-toasts nothing */
  }
}

/**
 * The bell — unread count plus the feed, for the signed-in user in the active
 * brand.
 *
 * OPENING IT = SEEN (user decision, 2026-10-20). The popover LISTS every
 * unread item (up to `BELL_UNREAD_CAP`, the newest read ones filling the
 * rest), so opening it marks read exactly what it showed: the badge drops at
 * once, ONE bounded action marks the listed ids, and the items that were
 * unread keep their "new" look for as long as this popover stays open (a
 * client snapshot) — you still see what was new. Unread beyond the cap stays
 * unread, and the footer says "+N more".
 *
 * FRESHNESS, deliberately cheap: refetch on every route change, on window
 * focus, on an interval while the tab is focused, and when another surface
 * announces a change (`NOTIFICATIONS_CHANGED_EVENT`). A hidden tab polls
 * nothing. `POLL_MS` is the single polling knob (see lib/notifications.ts).
 */
export function NotificationBell({
  userId,
  accountId,
  toastScope: savedScope = DEFAULT_TOAST_SCOPE,
}: {
  /** The signed-in person — the toasted pointer is per user. */
  userId: string;
  /** The active brand — the toasted pointer is per brand, like the feed. */
  accountId: string;
  /** This user's setting (migration 0050); `off` silences toasts only. */
  toastScope?: ToastScope;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // The saved setting, then whatever the account menu announces (W2-1): the
  // menu no longer re-renders the layout to hand this one word down.
  const [toastScope, setToastScope] = useState<ToastScope>(savedScope);
  useEffect(() => setToastScope(savedScope), [savedScope]);
  useEffect(() => onToastScopeChanged(setToastScope), []);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** Unread ids LISTED when this popover opened — they look new until it closes. */
  const [seenNow, setSeenNow] = useState<ReadonlySet<string>>(() => new Set());
  /** Unread the popover did NOT list when it opened (beyond the cap). */
  const [beyond, setBeyond] = useState(0);
  const [, startTransition] = useTransition();
  /** Set while the bell plays its one-shot shake (unread went UP). */
  const [shake, setShake] = useState(false);
  const prevCount = useRef<number | null>(null);
  useMinuteTick();

  const openHref = useCallback(
    (href: string | null) => {
      const safe = safeHref(href);
      if (safe) router.push(safe);
    },
    [router],
  );

  /**
   * ARRIVAL TOASTS. The poll the bell already runs is the only signal: an item
   * ahead of this browser's pointer is new, a burst collapses into one line,
   * and the FIRST load never toasts (a null pointer just adopts the newest id).
   * Everything about "what counts as new" is pure and lives in
   * lib/notifications.
   */
  const announce = useCallback(
    (fresh: FeedItem[]) => {
      if (fresh.length === 0) return;
      const newest = fresh[0]!; // newest-first, as the feed returns them
      const last = readToasted(userId, accountId);
      const plan = toastPlan(fresh, last, toastScope);
      // The pointer advances even when nothing toasted (first load, or an
      // arrival the scope filtered out) — those items are not new any more.
      writeToasted(userId, accountId, newest.id);

      if (plan.kind === "summary") {
        toast(burstSummary(plan.count), {
          description: "Open notifications to read them.",
          action: { label: "View", onClick: () => router.push("/notifications") },
        });
        return;
      }
      if (plan.kind !== "items") return;
      for (const item of plan.items) {
        const full = fresh.find((f) => f.id === item.id);
        if (!full) continue;
        toast(full.title, {
          description: full.actor ?? undefined,
          action: safeHref(full.href)
            ? {
                label: "Open",
                onClick: () => {
                  // The same flow clicking it in the popover runs: mark read,
                  // then go where it points.
                  startTransition(async () => {
                    const res = await safeAction(() =>
                      markNotificationRead({ id: full.id }),
                    );
                    if (!res.ok) toastActionFailure(res, "Couldn't mark that read.");
                    else announceNotificationsChanged("bell");
                    void load();
                  });
                  openHref(full.href);
                },
              }
            : undefined,
        });
      }
    },
    // `load` is defined below and stable; the lint rule can't see the cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, accountId, toastScope, router, openHref],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return; // a 401 mid-session: the next navigation redirects
      const data = (await res.json()) as { count: number; items: FeedItem[] };
      const next = data.items ?? [];
      setCount(data.count ?? 0);
      setItems(next);
      setLoaded(true);
      announce(next);
    } catch {
      /* offline or navigating away — the next tick tries again */
    }
  }, [announce]);

  // Route changes are the cheapest signal that something may have happened.
  useEffect(() => {
    void load();
  }, [load, pathname]);

  // Another surface (the panel opening a thread, /notifications) read or
  // cleared something: the badge follows at once — an event, not a timer.
  useEffect(() => onNotificationsChanged("bell", () => void load()), [load]);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const timer = window.setInterval(() => {
      // A background tab costs nothing: no request until it comes back.
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(timer);
    };
  }, [load]);

  /**
   * TAB TITLE: "(3) Ads" while anything is unread. Next rewrites the title on
   * every navigation, so this re-applies on `pathname` too and always strips
   * an existing prefix first — otherwise the counts would stack. On unmount it
   * puts back exactly what it found.
   */
  useEffect(() => {
    const apply = () => {
      const want = titleWithUnread(stripUnreadPrefix(document.title), count);
      if (document.title !== want) document.title = want;
    };
    apply();
    // Next also rewrites the title on a REFRESH (a photo change, a setting),
    // which changes neither `count` nor `pathname` — watch the <head> and put
    // the prefix back. Idempotent, so its own write settles the observer.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = stripUnreadPrefix(document.title);
    };
  }, [count, pathname]);

  /**
   * BELL MOTION: one brief shake when the unread count goes UP — never a
   * persistent animation, and the keyframes are behind
   * `prefers-reduced-motion` in globals.css. The first poll only seeds the
   * baseline, so arriving at a page with unread items doesn't shake.
   */
  useEffect(() => {
    if (!loaded) return;
    const prev = prevCount.current;
    prevCount.current = count;
    if (prev === null || count <= prev) return;
    setShake(true);
    const t = window.setTimeout(() => setShake(false), 700);
    return () => window.clearTimeout(t);
  }, [count, loaded]);

  /** Opening = seen: snapshot, drop the badge, mark the listed ids read. */
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // The "new" look lasts for ONE open.
      setSeenNow(new Set());
      return;
    }
    const plan = bellSeenPlan(items, count);
    setSeenNow(new Set(plan.ids));
    setBeyond(plan.beyond);
    if (plan.ids.length === 0) return;
    setCount(plan.beyond);
    setItems((list) => list.map((i) => (plan.ids.includes(i.id) ? { ...i, read: true } : i)));
    startTransition(async () => {
      const res = await safeAction(() => markNotificationsRead({ ids: plan.ids }));
      if (!res.ok) toastActionFailure(res, "Couldn't mark those read.");
      else announceNotificationsChanged("bell");
      // Either way, the server's count is the truth from here.
      void load();
    });
  };

  const openItem = (item: FeedItem) => {
    const href = safeHref(item.href);
    if (!item.read) {
      // Arrived while the popover was open — read it now, then go.
      setCount((c) => Math.max(0, c - 1));
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, read: true } : i)));
      startTransition(async () => {
        const res = await safeAction(() => markNotificationRead({ id: item.id }));
        if (!res.ok) toastActionFailure(res, "Couldn't mark that read.");
        else announceNotificationsChanged("bell");
        void load();
      });
    }
    onOpenChange(false);
    // A notification without a usable link still marks read — it just has
    // nowhere to send you.
    if (href) router.push(href);
  };

  const badge = badgeCount(count);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label={
          count > 0
            ? `Notifications — ${count > BADGE_CAP ? `${BADGE_CAP}+` : count} unread`
            : "Notifications"
        }
        className={cn(
          "relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink",
          shake && "bell-shake",
        )}
      >
        <Bell className="h-4 w-4" />
        {badge && (
          <span className="num absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-brand px-1 text-[10px] font-medium leading-4 text-[var(--primary-foreground)]">
            {badge}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-1.5rem))] p-0"
      >
        <div className="border-b border-line px-3 py-2">
          <span className="text-sm font-medium text-ink">Notifications</span>
        </div>

        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-ink-3">
            {loaded ? "Nothing yet." : "Loading…"}
          </p>
        ) : (
          <ul className="max-h-[min(24rem,60vh)] divide-y divide-line overflow-y-auto">
            {items.map((item) => {
              const isNew = !item.read || seenNow.has(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2",
                      isNew && "bg-[var(--brand-soft)]/40",
                    )}
                  >
                    <NotificationAvatar
                      actor={item.actor}
                      avatarUrl={item.actorAvatarUrl}
                      category={item.category}
                    />
                    <span className="min-w-0 flex-1">
                      {/* The title is an English template: LTR, with the
                          names inside it already isolated by the producer. */}
                      <span
                        dir="ltr"
                        className={cn(
                          "line-clamp-2 text-xs",
                          isNew ? "font-medium text-ink" : "text-ink-2",
                        )}
                      >
                        {item.title}
                      </span>
                      {item.body && (
                        // The comment itself — its OWN direction.
                        <span dir="auto" className="mt-0.5 line-clamp-2 text-[11px] text-ink-3">
                          {item.body}
                        </span>
                      )}
                      <time
                        dateTime={item.createdAt}
                        title={dateTimeLabel(item.createdAt)}
                        className="mt-0.5 block text-[10px] text-ink-3"
                      >
                        {relativeTime(item.createdAt)}
                      </time>
                    </span>
                    {isNew && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand">
                        <span className="sr-only">New</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between border-t border-line px-3 py-2">
          <Link
            href="/notifications"
            onClick={() => onOpenChange(false)}
            className="text-xs text-brand hover:underline"
          >
            View all
          </Link>
          {beyond > 0 && (
            <Link
              href="/notifications?tab=unread"
              onClick={() => onOpenChange(false)}
              className="num text-xs text-brand hover:underline"
              aria-label={`${beyond} more unread`}
            >
              +{beyond} more
            </Link>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
