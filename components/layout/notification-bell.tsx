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
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BADGE_CAP,
  CATEGORY_LABEL,
  DEFAULT_TOAST_SCOPE,
  POLL_MS,
  badgeCount,
  burstSummary,
  isNotificationCategory,
  safeHref,
  stripUnreadPrefix,
  titleWithUnread,
  toastPlan,
  toastedStorageKey,
  type ToastScope,
} from "@/lib/notifications";
import { markNotificationRead } from "@/app/actions/notifications";

interface FeedItem {
  id: string;
  /** The stored event type — `toastPlan` needs it to spot a DIRECT event. */
  type: string;
  category: string;
  title: string;
  href: string | null;
  actor: string | null;
  createdAt: string;
  read: boolean;
}

/**
 * The toasted-pointer store: the newest id this BROWSER has already toasted,
 * per brand. Per the house storage discipline every access is guarded — a
 * private window, blocked site data or a thumbnail capture can throw or return
 * nothing, and the bell must work regardless (it just falls back to "first
 * load", which toasts nothing).
 */
function readToasted(accountId: string): string | null {
  try {
    return window.localStorage.getItem(toastedStorageKey(accountId));
  } catch {
    return null;
  }
}

function writeToasted(accountId: string, id: string): void {
  try {
    window.localStorage.setItem(toastedStorageKey(accountId), id);
  } catch {
    /* storage unavailable — the session simply re-toasts nothing */
  }
}

/**
 * The bell — unread count plus the latest few, for the signed-in user in the
 * active brand.
 *
 * FRESHNESS, deliberately cheap: refetch on every route change, on window
 * focus, and on an interval while the tab is focused. A hidden tab polls
 * nothing. `POLL_MS` is the single knob (see lib/notifications.ts) — the
 * hosting plan decides its value, not this component.
 */
export function NotificationBell({
  accountId,
  toastScope = DEFAULT_TOAST_SCOPE,
}: {
  /** The active brand — the toasted pointer is per brand, like the feed. */
  accountId: string;
  /** This user's setting (migration 0050); `off` silences toasts only. */
  toastScope?: ToastScope;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [, startTransition] = useTransition();
  /** Set while the bell plays its one-shot shake (unread went UP). */
  const [shake, setShake] = useState(false);
  const prevCount = useRef<number | null>(null);

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
      const last = readToasted(accountId);
      const plan = toastPlan(fresh, last, toastScope);
      // The pointer advances even when nothing toasted (first load, or an
      // arrival the scope filtered out) — those items are not new any more.
      writeToasted(accountId, newest.id);

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
                    await markNotificationRead({ id: full.id });
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
    [accountId, toastScope, router, openHref],
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
    const original = stripUnreadPrefix(document.title);
    document.title = titleWithUnread(original, count);
    return () => {
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
    // Nothing is known until the first poll lands; the count is 0 before it,
    // and 0 → 3 is not an arrival.
    if (!loaded) return;
    const prev = prevCount.current;
    prevCount.current = count;
    // The FIRST loaded count is the baseline, not an increase: opening a page
    // with unread items must not shake, for the same reason it must not toast.
    if (prev === null || count <= prev) return;
    setShake(true);
    const t = window.setTimeout(() => setShake(false), 700);
    return () => window.clearTimeout(t);
  }, [count, loaded]);

  const openItem = (item: FeedItem) => {
    const href = safeHref(item.href);
    if (!item.read) {
      // Optimistic: the badge drops now, the server catches up.
      setCount((c) => Math.max(0, c - 1));
      setItems((list) =>
        list.map((i) => (i.id === item.id ? { ...i, read: true } : i)),
      );
      startTransition(async () => {
        await markNotificationRead({ id: item.id });
        void load();
      });
    }
    setOpen(false);
    // A notification without a usable link still marks read — it just has
    // nowhere to send you.
    if (href) router.push(href);
  };

  const badge = badgeCount(count);

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-sm font-medium text-ink">Notifications</span>
          {count > 0 && (
            <span className="num text-[11px] text-ink-3">{count} unread</span>
          )}
        </div>

        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-ink-3">
            {loaded ? "Nothing yet." : "Loading…"}
          </p>
        ) : (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className={cn(
                    "w-full px-3 py-2 text-left transition-colors hover:bg-surface-2",
                    !item.read && "bg-[var(--brand-soft)]/40",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="rounded-sm border border-line px-1 text-[10px] text-ink-3">
                      {isNotificationCategory(item.category)
                        ? CATEGORY_LABEL[item.category]
                        : item.category}
                    </span>
                    <span className="ml-auto text-[10px] text-ink-3">
                      {relativeTime(item.createdAt)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block text-xs",
                      item.read ? "text-ink-2" : "font-medium text-ink",
                    )}
                  >
                    {item.title}
                  </span>
                  {item.actor && (
                    <span className="text-[10px] text-ink-3">{item.actor}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-line px-3 py-2">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="text-xs text-brand hover:underline"
          >
            View all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
