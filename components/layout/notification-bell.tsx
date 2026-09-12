"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
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
  POLL_MS,
  badgeCount,
  isNotificationCategory,
  safeHref,
} from "@/lib/notifications";
import { markNotificationRead } from "@/app/actions/notifications";

interface FeedItem {
  id: string;
  category: string;
  title: string;
  href: string | null;
  actor: string | null;
  createdAt: string;
  read: boolean;
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
export function NotificationBell() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [, startTransition] = useTransition();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return; // a 401 mid-session: the next navigation redirects
      const data = (await res.json()) as { count: number; items: FeedItem[] };
      setCount(data.count ?? 0);
      setItems(data.items ?? []);
      setLoaded(true);
    } catch {
      /* offline or navigating away — the next tick tries again */
    }
  }, []);

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
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
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
