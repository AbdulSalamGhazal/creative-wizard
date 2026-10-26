"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CornerDownRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/empty-state";
import { UserAvatar } from "@/components/user/user-avatar";
import { CommentBody } from "@/components/comments/comment-body";
import { anchorIcon } from "@/components/filters/filter-icons";
import { dateTimeLabel, int, relativeTime } from "@/lib/format";
import { useNavTransition } from "@/lib/nav-progress";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { cn } from "@/lib/utils";
import { groupNotifications } from "@/lib/notifications";
import { COMMENT_ANCHOR_TYPES, type CommentAnchorType } from "@/lib/comments";
import {
  ACTIVITY_WHO,
  ACTIVITY_WHO_LABEL,
  ANCHOR_FALLBACK_LABEL,
  ANCHOR_TYPE_LABEL,
  activityHref,
  isActivityFiltered,
  type ActivityParams,
  type ActivityWho,
} from "@/lib/activity";
import type { ActivityRow } from "@/db/queries/activity";

/**
 * The /activity surface (2026-10): Everyone | Mine, the search + type chips,
 * and the brand's comments newest first — day groups, and inside a day every
 * CONSECUTIVE run on one thing under ONE header naming it (the creative, the
 * campaign, the month, the page), its comments beneath; replies indent. A
 * row opens the comment WHERE IT WAS WRITTEN (`/go/comment/[id]`: the page,
 * the captured view, the panel on that comment).
 *
 * The URL is the state, as on /notifications: a filtered feed is shareable
 * and Back works; every change is a navigation through `useNavTransition`
 * and the page is `force-dynamic`, so nothing here refreshes by hand.
 */

/** A navigation to the feed with some params changed. Any change resets the
 *  page — page 3 of a different result set is a different, usually empty,
 *  thing — unless the change IS the page. */
function useActivityNav(params: ActivityParams) {
  const router = useRouter();
  const [, startNav] = useNavTransition();
  return (next: Partial<ActivityParams>) =>
    startNav(() => router.replace(activityHref({ ...params, page: 1, ...next }), { scroll: false }));
}

/** Everyone | Mine — rendered in the page header's right slot. */
export function ActivityWhoSwitch({ params }: { params: ActivityParams }) {
  const navigate = useActivityNav(params);
  return (
    <SegmentedControl<ActivityWho>
      ariaLabel="Whose comments"
      value={params.who}
      onChange={(who) => navigate({ who })}
      options={ACTIVITY_WHO.map((who) => ({ value: who, label: ACTIVITY_WHO_LABEL[who] }))}
    />
  );
}

export function ActivityFeed({
  params,
  rows,
  total,
  page,
  pageSize,
  today,
}: {
  params: ActivityParams;
  rows: ActivityRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Today in UTC, from the server — the day headers' clock. */
  today: string;
}) {
  const router = useRouter();
  const [, startNav] = useNavTransition();
  const navigate = useActivityNav(params);
  const [search, setSearch] = useState(params.q);
  useEffect(() => setSearch(params.q), [params.q]);
  // "3m ago" stays true while the page sits open — one tick per surface.
  useMinuteTick();

  const submitSearch = (value: string) => navigate({ q: value.trim() });
  const toggleType = (type: CommentAnchorType) => {
    const on = new Set(params.types);
    if (on.has(type)) on.delete(type);
    else on.add(type);
    // Canonical order, so two spellings of one selection share a URL.
    navigate({ types: COMMENT_ANCHOR_TYPES.filter((t) => on.has(t)) });
  };
  const open = (row: ActivityRow) => startNav(() => router.push(`/go/comment/${row.id}`));

  /** Day groups; consecutive same-anchor rows form one run. Pure helper. */
  const days = useMemo(
    () =>
      groupNotifications(
        rows.map((r) => ({ ...r, entityType: r.anchorType, entityId: r.anchorId })),
        today,
      ),
    [rows, today],
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const empty = isActivityFiltered(params)
    ? { title: "No matches", hint: "Try a different search or fewer filters." }
    : params.who === "me"
      ? {
          title: "You haven’t commented yet",
          hint: "Everything you write, in every thread, shows here.",
        }
      : {
          title: "No comments yet",
          hint: "Open a creative, campaign or page and start a thread.",
        };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
        {/* The box takes the whole row on a phone and the chips wrap under
            it; beside them it would shrink to its icon (375px pass). */}
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-xs">
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
            onBlur={() => search.trim() !== params.q && submitSearch(search)}
            placeholder="Search comments"
            className="h-8 pl-8"
            aria-label="Search comments"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {COMMENT_ANCHOR_TYPES.map((type) => {
            const on = params.types.includes(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                aria-pressed={on}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  on
                    ? "border-brand bg-[var(--brand-soft)] text-ink"
                    : "border-line text-ink-3 hover:text-ink",
                )}
              >
                {ANCHOR_TYPE_LABEL[type]}
              </button>
            );
          })}
        </div>
      </div>

      {/* The feed — day groups of run cards. */}
      {rows.length === 0 ? (
        <EmptyState title={empty.title} hint={empty.hint} />
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <section key={day.day} className="space-y-1.5">
              <h3 className="text-label text-ink-3">{day.label}</h3>
              <ul className="space-y-2">
                {day.items.map((item) => (
                  <li key={item.key} className="rounded-lg border border-line bg-surface">
                    <RunHeader row={item.rows[0]!} />
                    <div className="divide-y divide-line">
                      {item.rows.map((row) => (
                        <ActivityComment key={row.id} row={row} onOpen={open} />
                      ))}
                    </div>
                  </li>
                ))}
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
              onClick={() => navigate({ page: page - 1 })}
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
              onClick={() => navigate({ page: page + 1 })}
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
 * The run's header: the thing these comments are about, named ONCE — its
 * glyph (the nav's own) and its current name, a link to it. When the thing
 * is gone the header says so, muted, and links nowhere.
 */
function RunHeader({ row }: { row: ActivityRow }) {
  const Icon = anchorIcon(row.anchorType, row.anchorId);
  const label = row.anchorLabel ?? ANCHOR_FALLBACK_LABEL[row.anchorType];
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 pb-1 pt-2.5 text-xs">
      <Icon className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
      <span className="sr-only">{ANCHOR_TYPE_LABEL[row.anchorType]} · </span>
      {row.anchorPath ? (
        <Link href={row.anchorPath} className="min-w-0 truncate font-medium text-brand hover:underline">
          <bdi>{label}</bdi>
        </Link>
      ) : (
        <span className="min-w-0 truncate text-ink-3">
          <bdi>{label}</bdi>
        </span>
      )}
    </div>
  );
}

/**
 * One comment: the thread row's anatomy (avatar · name · time · edited ·
 * reply marker · body), the body clamped — the feed is for finding, the
 * thread for reading. The ROW opens the comment where it was written; the
 * author's name is the keyboard-reachable control for the same thing, and a
 * link inside the body still opens as a link. A row whose anchor is gone is
 * inert: there is nowhere to go.
 */
function ActivityComment({
  row,
  onOpen,
}: {
  row: ActivityRow;
  onOpen: (row: ActivityRow) => void;
}) {
  const isReply = row.parentId !== null;
  const live = row.anchorPath !== null;
  const name = row.authorName ?? "Former member";
  return (
    <div
      onClick={
        live
          ? (e) => {
              if (e.target instanceof Element && e.target.closest("a")) return;
              onOpen(row);
            }
          : undefined
      }
      className={cn(
        "flex gap-3 px-3 py-3",
        isReply && "pl-9",
        live && "cursor-pointer transition-colors hover:bg-surface-2",
      )}
    >
      <UserAvatar
        name={row.authorName}
        src={row.authorAvatarUrl}
        size={isReply ? "sm" : "md"}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-ink-3">
          {live ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(row);
              }}
              className="min-w-0 truncate text-xs font-medium text-ink hover:underline"
            >
              <bdi>{name}</bdi>
              <span className="sr-only"> — open where it was written</span>
            </button>
          ) : (
            <bdi className="min-w-0 truncate text-xs font-medium text-ink">{name}</bdi>
          )}
          <time dateTime={row.createdAt.toISOString()} title={dateTimeLabel(row.createdAt)}>
            {relativeTime(row.createdAt)}
          </time>
          {row.editedAt && <span>· edited</span>}
          {isReply && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden />
              <span className="sr-only">reply to </span>
              <bdi className="truncate">{row.parentAuthorName ?? "Former member"}</bdi>
            </span>
          )}
        </div>
        <CommentBody
          body={row.body}
          mentionNames={row.mentionNames}
          className="comment-body mt-0.5 line-clamp-3 text-sm text-ink-2"
        />
      </div>
    </div>
  );
}
