"use client";

import { useEffect, useState, useTransition } from "react";
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
import { int, relativeTime } from "@/lib/format";
import { useNavTransition } from "@/lib/nav-progress";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  NOTIFICATION_CATEGORIES,
  categoryForType,
  safeHref,
  type NotificationCategory,
} from "@/lib/notifications";
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
}: {
  tab: NotificationTab;
  categories: string[];
  q: string;
  rows: NotificationRow[];
  total: number;
  page: number;
  pageSize: number;
  unread: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startNav] = useNavTransition();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(q);

  // The URL is the state: a filtered view is shareable, and Back works.
  useEffect(() => setSearch(q), [q]);

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

  const act = (fn: () => Promise<{ ok: boolean; error?: string; affected?: number }>, done?: (n: number) => string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "That didn't work.");
        return;
      }
      if (done) toast.success(done(res.affected ?? 0));
      router.refresh();
    });

  const open = (row: NotificationRow) => {
    const href = safeHref(row.href);
    if (row.readAt === null) {
      startTransition(async () => {
        await markNotificationRead({ id: row.id });
        router.refresh();
      });
    }
    if (href) router.push(href);
  };

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
              act(markAllRead, (n) => `Marked ${int(n)} as read.`)
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
              act(archiveAllRead, (n) =>
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

      {/* List */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
          <h3 className="text-sm font-medium text-ink">{emptyCopy.title}</h3>
          <p className="mx-auto mt-1 max-w-prose text-xs text-ink-3">{emptyCopy.body}</p>
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {rows.map((row) => {
            const category = categoryForType(row.type);
            const unreadRow = row.readAt === null;
            return (
              <li
                key={row.id}
                className={cn(
                  "flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start",
                  unreadRow && "bg-[var(--brand-soft)]/30",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
                      {CATEGORY_LABEL[category]}
                    </span>
                    <span className="text-[11px] text-ink-3">
                      {row.actorName ?? "System"} · {relativeTime(row.createdAt)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => open(row)}
                    className={cn(
                      "mt-1 block text-left text-sm",
                      unreadRow ? "font-medium text-ink" : "text-ink-2",
                      safeHref(row.href) && "hover:underline",
                    )}
                  >
                    {row.title}
                  </button>
                  {row.body && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">{row.body}</p>
                  )}
                </div>

                {/* Row actions stay reachable at 375px: they wrap under the
                    text rather than being squeezed beside it. */}
                <div className="flex shrink-0 items-center gap-1.5 sm:pt-1">
                  {row.archivedAt === null ? (
                    <>
                      {unreadRow && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={isPending}
                          onClick={() => act(() => markNotificationRead({ id: row.id }))}
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
                        onClick={() => act(() => archiveNotification({ id: row.id }))}
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
                      onClick={() => act(() => unarchiveNotification({ id: row.id }))}
                    >
                      <ArchiveRestore className="h-3.5 w-3.5" />
                      Restore
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
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
