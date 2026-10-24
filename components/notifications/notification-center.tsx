"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { dateTimeLabel, int, relativeTime } from "@/lib/format";
import { useNavTransition } from "@/lib/nav-progress";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  NOTIFICATION_CATEGORIES,
  announceNotificationsChanged,
  anchorLabelFromTitle,
  burstLabel,
  categoryForType,
  groupNotifications,
  onNotificationsChanged,
  safeHref,
  type NotificationCategory,
} from "@/lib/notifications";
import { NotificationAvatar } from "@/components/notifications/notification-avatar";
import { safeAction } from "@/lib/action-failure";
import { afterNavigation } from "@/lib/router-queue";
import { toastActionFailure } from "@/lib/action-toast";
import {
  archiveAllRead,
  archiveNotification,
  markAllRead,
  markNotificationRead,
  unarchiveNotification,
} from "@/app/actions/notifications";
import type {
  NotificationRow,
  NotificationTab,
} from "@/db/queries/notifications";

/**
 * The /notifications surface: tabs, category chips, search, the paginated
 * list and its per-row actions.
 *
 * A list rather than a DataTable on purpose — these rows are prose (a title, a
 * body preview, who did it, when), not columns to sort and compare.
 */
export function NotificationCenter({
  tab,
  categories,
  q,
  rows,
  total,
  page,
  pageSize,
  unread,
  today,
}: {
  tab: NotificationTab;
  categories: string[];
  q: string;
  rows: NotificationRow[];
  total: number;
  page: number;
  pageSize: number;
  unread: number;
  /** Today in UTC, from the server — the day headers' clock. */
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startNav] = useNavTransition();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(q);
  /** Which collapsed bursts the reader has opened (by their first row's id). */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // The URL is the state: a filtered view is shareable, and Back works.
  useEffect(() => setSearch(q), [q]);

  // The bell marked something read while this page is on screen: re-render
  // the list. (The actions no longer revalidate — see lib/notifications.)
  useEffect(
    () => onNotificationsChanged("center", () => router.refresh()),
    [router],
  );

  const setParams = (next: Record<string, string | null>) => {
    const params = new URLSearchParams();
    if (tab !== "all") params.set("tab", tab);
    if (categories.length > 0) params.set("categories", categories.join(","));
    if (q) params.set("q", q);
    if (page > 1) params.set("page", String(page));
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    startNav(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  // Any filter change returns to page 1 — page 3 of a different result set is
  // a different, usually empty, thing.
  const setTab = (next: NotificationTab) => setParams({ tab: next, page: null });
  const toggleCategory = (category: NotificationCategory) => {
    const next = categories.includes(category)
      ? categories.filter((c) => c !== category)
      : [...categories, category];
    setParams({ categories: next.join(","), page: null });
  };

  const submitSearch = (value: string) => setParams({ q: value.trim(), page: null });

  /** `fn` is already `safeAction`-wrapped at the call site (the guard in
   *  app/actions/action-calls.test.ts reads every call lexically). */
  const act = (
    fn: () => Promise<{ ok: boolean; error?: string; affected?: number; stale?: boolean }>,
    done?: (n: number) => string,
  ) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toastActionFailure(res, "That didn't work.");
        return;
      }
      if (done) toast.success(done(res.affected ?? 0));
      router.refresh();
      announceNotificationsChanged("center");
    });

  const open = (row: NotificationRow) => {
    const href = safeHref(row.href);
    if (href) router.push(href);
    if (row.readAt === null) {
      // Read it BEHIND the navigation: an action still pending when the
      // navigation starts costs the destination a second render
      // (lib/router-queue.ts). Leaving, there's no list to refresh.
      afterNavigation(() =>
        startTransition(async () => {
          const res = await safeAction(() => markNotificationRead({ id: row.id }));
          if (!res.ok) {
            toastActionFailure(res, "Couldn't mark that read.");
            return;
          }
          if (!href) router.refresh();
          announceNotificationsChanged("center");
        }),
      );
    }
  };

  /** Day groups, with consecutive same-anchor runs collapsed. Pure helper. */
  const days = useMemo(() => groupNotifications(rows, today), [rows, today]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const emptyCopy =
    tab === "unread"
      ? { title: "You're all caught up", body: "Nothing unread in this brand." }
      : tab === "archived"
        ? { title: "Nothing cleared yet", body: "Cleared notifications land here — and stay searchable." }
        : q || categories.length > 0
          ? { title: "No matches", body: "Try a different search or fewer categories." }
          : {
              title: "Nothing yet",
              body: "Events only notify the people they're routed to. An admin sets that up under Configuration → Notifications.",
            };

  return (
    <div className="space-y-4">
      {/* Tabs + bulk actions */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<NotificationTab>
          ariaLabel="Notification tab"
          value={tab}
          onChange={setTab}
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: unread > 0 ? `Unread (${unread})` : "Unread" },
            { value: "archived", label: "Archived" },
          ]}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={unread === 0 || isPending}
            onClick={() =>
              act(() => safeAction(() => markAllRead()), (n) => `Marked ${int(n)} as read.`)
            }
          >
            <Check className="h-3.5 w-3.5" />
            Mark all read
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              act(() => safeAction(() => archiveAllRead()), (n) =>
                n === 0 ? "Nothing read to clear." : `Cleared ${int(n)}.`,
              )
            }
          >
            <Archive className="h-3.5 w-3.5" />
            Archive all read
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSearch(search);
              if (e.key === "Escape") {
                setSearch("");
                submitSearch("");
              }
            }}
            onBlur={() => search.trim() !== q && submitSearch(search)}
            placeholder="Search notifications"
            className="h-8 pl-8"
            aria-label="Search notifications"
          />
        </div>
        {/* All five categories, even the ones phase 1 never produces — the
            shape of the system is visible from day one. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {NOTIFICATION_CATEGORIES.map((category) => {
            const on = categories.includes(category);
            return (
              <button
                key={category}
                type="button"
                onClick={() => toggleCategory(category)}
                aria-pressed={on}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  on
                    ? "border-brand bg-[var(--brand-soft)] text-ink"
                    : "border-line text-ink-3 hover:text-ink",
                )}
              >
                {CATEGORY_LABEL[category]}
              </button>
            );
          })}
        </div>
      </div>

      {/* List — day groups, each a chronological run of rows and collapsed
          bursts. The grouping is pure (`groupNotifications`); this renders it. */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
          <h3 className="text-sm font-medium text-ink">{emptyCopy.title}</h3>
          <p className="mx-auto mt-1 max-w-prose text-xs text-ink-3">{emptyCopy.body}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <section key={day.day} className="space-y-1.5">
              <h3 className="text-label text-ink-3">{day.label}</h3>
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                {day.items.map((item) => {
                  const first = item.rows[0]!;
                  const isOpen = expanded.has(item.key);
                  const unreadInGroup = item.rows.filter((r) => r.readAt === null);
                  if (!item.collapsed) {
                    return (
                      <li key={item.key}>
                        <NotificationRow
                          row={first}
                          isPending={isPending}
                          onOpen={open}
                          onAct={act}
                        />
                      </li>
                    );
                  }
                  return (
                    <li key={item.key} className="px-3 py-2">
                      {/* ONE row for a run of updates on the same thing. The
                          count is the point — five lines saying "Sara
                          commented" tell you less than one saying five. */}
                      <div className="group/burst flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.key)) next.delete(item.key);
                              else next.add(item.key);
                              return next;
                            })
                          }
                          aria-expanded={isOpen}
                          className="inline-flex min-w-0 items-center gap-2 text-left text-sm text-ink"
                        >
                          <ChevronRight
                            className={cn(
                              "h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform",
                              isOpen && "rotate-90",
                            )}
                            aria-hidden
                          />
                          <span dir="ltr" className="truncate">
                            {burstLabel(
                              item.rows.length,
                              anchorLabelFromTitle(first.title, first.type),
                            )}
                          </span>
                          {unreadInGroup.length > 0 && (
                            <span className="num rounded-full bg-brand px-1.5 text-[10px] leading-4 text-[var(--primary-foreground)]">
                              {unreadInGroup.length}
                            </span>
                          )}
                        </button>
                        <span className="text-[11px] text-ink-3">
                          {relativeTime(first.createdAt)}
                        </span>
                        {/* Mark-read acts on the GROUP: the collapse is the row
                            now, so its action has to be the row's action. */}
                        <span
                          className={cn(
                            "ml-auto flex items-center gap-1.5",
                            ACTION_REVEAL,
                            "group-hover/burst:opacity-100 group-focus-within/burst:opacity-100",
                          )}
                        >
                          {unreadInGroup.length > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              disabled={isPending}
                              onClick={() =>
                                act(async () => {
                                  for (const r of unreadInGroup) {
                                    const res = await safeAction(() =>
                                      markNotificationRead({ id: r.id }),
                                    );
                                    // Stop at the first refusal and say so.
                                    if (!res.ok) return res;
                                  }
                                  return { ok: true };
                                })
                              }
                            >
                              <Check className="h-3.5 w-3.5" />
                              Read all
                            </Button>
                          )}
                        </span>
                      </div>
                      {isOpen && (
                        <ul className="mt-1 divide-y divide-line border-t border-line">
                          {item.rows.map((row) => (
                            <li key={row.id}>
                              <NotificationRow
                                row={row}
                                nested
                                isPending={isPending}
                                onOpen={open}
                                onAct={act}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Pager */}
      {total > pageSize && (
        <div className="flex items-center justify-between gap-3 px-1 text-xs text-ink-3">
          <span className="num">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {int(total)}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={page <= 1}
              onClick={() => setParams({ page: String(page - 1) })}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Button>
            <span className="num">
              Page {page} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={page >= totalPages}
              onClick={() => setParams({ page: String(page + 1) })}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Row actions appear on HOVER or FOCUS and are ALWAYS visible where there is no
 * hover (touch) — the comment menu's precedent, so the list stays quiet
 * without hiding anything from a finger.
 */
const ACTION_REVEAL =
  "opacity-0 transition-opacity focus-within:opacity-100 [@media(hover:none)]:opacity-100";

/** One notification: who, what, when — and the actions, on hover. */
function NotificationRow({
  row,
  nested = false,
  isPending,
  onOpen,
  onAct,
}: {
  row: NotificationRow;
  /** Inside an expanded burst — indented, no day context of its own. */
  nested?: boolean;
  isPending: boolean;
  onOpen: (row: NotificationRow) => void;
  onAct: (
    fn: () => Promise<{ ok: boolean; error?: string; affected?: number; stale?: boolean }>,
  ) => void;
}) {
  const category = categoryForType(row.type);
  const unreadRow = row.readAt === null;
  const actor = row.actorName;

  return (
    <div
      className={cn(
        "group/row flex gap-3 px-3 py-3",
        nested && "pl-6",
        unreadRow && "bg-[var(--brand-soft)]/30",
      )}
    >
      {/* Who it was — the shared avatar (photo, or initials in their own
          colour) — with the category glyph tucked against it, so the kind
          reads at a glance without a label. */}
      <span className="mt-0.5">
        <NotificationAvatar
          actor={actor}
          avatarUrl={row.actorAvatarUrl}
          category={category}
        />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-ink-3">
          <span className="sr-only">{CATEGORY_LABEL[category]} · </span>
          <bdi>{actor ?? "System"}</bdi>
          <span aria-hidden>·</span>
          <time dateTime={row.createdAt.toISOString()} title={dateTimeLabel(row.createdAt)}>
            {relativeTime(row.createdAt)}
          </time>
        </div>
        {/* The title is an English template — LTR — with the names inside
            it isolated by the producer, so an Arabic name can't flip it. */}
        <button
          type="button"
          dir="ltr"
          onClick={() => onOpen(row)}
          className={cn(
            "mt-0.5 block text-left text-sm",
            unreadRow ? "font-medium text-ink" : "text-ink-2",
            safeHref(row.href) && "hover:underline",
          )}
        >
          {row.title}
        </button>
        {row.body && (
          // The comment itself, in its OWN direction.
          <p dir="auto" className="mt-0.5 line-clamp-2 text-xs text-ink-3">
            {row.body}
          </p>
        )}
      </div>

      <div
        className={cn(
          "flex shrink-0 items-start gap-1.5",
          ACTION_REVEAL,
          "group-hover/row:opacity-100",
        )}
      >
        {row.archivedAt === null ? (
          <>
            {unreadRow && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={isPending}
                aria-label="Mark as read"
                onClick={() => onAct(() => safeAction(() => markNotificationRead({ id: row.id })))}
              >
                <Check className="h-3.5 w-3.5" />
                Read
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isPending}
              aria-label="Clear notification"
              onClick={() => onAct(() => safeAction(() => archiveNotification({ id: row.id })))}
            >
              <Archive className="h-3.5 w-3.5" />
              Clear
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isPending}
            onClick={() => onAct(() => safeAction(() => unarchiveNotification({ id: row.id })))}
          >
            <ArchiveRestore className="h-3.5 w-3.5" />
            Restore
          </Button>
        )}
      </div>
    </div>
  );
}
