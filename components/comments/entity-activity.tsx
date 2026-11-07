"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CirclePause, CirclePlay, X } from "lucide-react";
import { SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user/user-avatar";
import { useCommentAnchor } from "@/components/comments/comment-anchor-context";
import { anchorKeyOf } from "@/components/comments/comment-panel";
import { dateTimeLabel, relativeTime } from "@/lib/format";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { dayGroupLabel, utcDay } from "@/lib/notifications";
import { PLATFORM_LABEL } from "@/lib/palette";
import { ACTION_SETTLED_EVENT } from "@/lib/action-failure";
import {
  visibleStatusEvents,
  type EntityActivityRow,
  type StatusEvent,
} from "@/lib/entity-activity";

/**
 * The panel's ACTIVITY face (2026-11-07): the entity's history — what was
 * done TO it, on its page or anywhere else (its edits, the exclusions on its
 * records), newest first, each with who and when (ENTITY_ACTIVITY_ACTIONS); plus the two
 * things the DATA says happened, went live and stopped, per platform. Actions
 * only: comments have their own face. Anyone who can open the page sees it.
 *
 * Read-only, so it never calls a server action: one GET per page
 * (`/api/entity-activity`), "Show older" for the next.
 */

type Item =
  | { kind: "event"; key: string; at: string; row: EntityActivityRow }
  | { kind: "status"; key: string; at: string; event: StatusEvent };

interface Loaded {
  rows: EntityActivityRow[];
  status: StatusEvent[];
  hasMore: boolean;
}

const platformLabel = (p: string): string =>
  (PLATFORM_LABEL as Record<string, string>)[p] ?? p;

export function EntityActivityBody({
  onClose,
  inSheet,
}: {
  onClose: () => void;
  inSheet: boolean;
}) {
  const anchor = useCommentAnchor();
  const anchorKey = anchorKeyOf(anchor);
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  // An answer about an entity the reader already left must not land.
  const current = useRef(anchorKey);
  current.current = anchorKey;
  useMinuteTick();

  const fetchPage = useCallback(
    async (before: number | null) => {
      if (!anchor || anchor.type === "view") return null;
      const qs = new URLSearchParams({ type: anchor.type, id: anchor.id });
      if (before !== null) qs.set("before", String(before));
      const res = await fetch(`/api/entity-activity?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as {
        rows: EntityActivityRow[];
        hasMore: boolean;
        status: StatusEvent[] | null;
      };
    },
    // `anchorKey` is the identity; `anchor` is a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anchorKey],
  );

  const load = useCallback(async () => {
    const key = anchorKey;
    setFailed(false);
    try {
      const page = await fetchPage(null);
      if (current.current !== key || !page) return;
      setData({ rows: page.rows, status: page.status ?? [], hasMore: page.hasMore });
    } catch {
      if (current.current === key) setFailed(true);
    }
  }, [anchorKey, fetchPage]);

  useEffect(() => {
    setData(null);
    if (anchorKey) void load();
  }, [anchorKey, load]);

  // A write anywhere on the page (a priority change, an exclusion) may be
  // the next line here: refetch the first page, quietly — what is on screen
  // stays until the answer arrives. Its audit row commits before the action
  // returns, so one refetch is enough.
  useEffect(() => {
    if (!anchorKey) return;
    const onWrite = () => void load();
    window.addEventListener(ACTION_SETTLED_EVENT, onWrite);
    return () => window.removeEventListener(ACTION_SETTLED_EVENT, onWrite);
  }, [anchorKey, load]);

  const loadMore = async () => {
    if (!data || data.rows.length === 0) return;
    const key = anchorKey;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await fetchPage(data.rows[data.rows.length - 1]!.id);
      if (current.current !== key || !page) return;
      setData({ ...data, rows: [...data.rows, ...page.rows], hasMore: page.hasMore });
    } catch {
      if (current.current === key) setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  /** Audit rows and the status events loaded so far, newest first, by day. */
  const days = useMemo(() => {
    if (!data) return [];
    const oldest = data.rows.length ? new Date(data.rows[data.rows.length - 1]!.at) : null;
    const items: Item[] = [
      ...data.rows.map((row) => ({ kind: "event" as const, key: `e${row.id}`, at: row.at, row })),
      ...visibleStatusEvents(data.status, oldest, !data.hasMore).map((event) => ({
        kind: "status" as const,
        key: `s${event.platform}${event.kind}${event.day}`,
        // A derived event has a day, no time: it sits at the START of its
        // day, under that day's actions.
        at: `${event.day}T00:00:00.000Z`,
        event,
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const today = utcDay(new Date());
    const out: Array<{ day: string; label: string; items: Item[] }> = [];
    for (const item of items) {
      const day = utcDay(item.at);
      let group = out[out.length - 1];
      if (!group || group.day !== day) {
        group = { day, label: dayGroupLabel(day, today), items: [] };
        out.push(group);
      }
      group.items.push(item);
    }
    return out;
  }, [data]);

  return (
    <>
      <div className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          {inSheet ? (
            <SheetTitle className="truncate text-sm">Activity</SheetTitle>
          ) : (
            <h2 className="truncate text-sm font-medium text-ink">Activity</h2>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onClose}
          aria-label="Close activity"
          className="h-7 w-7 shrink-0 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!anchor || (data === null && !failed) ? (
          <ActivitySkeleton />
        ) : failed ? (
          <div className="py-8 text-center text-xs text-ink-3">
            <p>Couldn&rsquo;t load activity</p>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="mt-1 text-brand"
              onClick={() => void load()}
            >
              Retry
            </Button>
          </div>
        ) : days.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-xs text-ink-2">No activity yet</p>
            <p className="mt-1 text-[11px] text-ink-3">
              {anchor.type === "budget_month"
                ? "Changes to this month’s plan show here."
                : "Edits and exclusions show here."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {days.map((day) => (
              <section key={day.day} className="space-y-1">
                <h3 className="px-1 text-label text-ink-3">{day.label}</h3>
                <ol className="space-y-0.5">
                  {day.items.map((item) =>
                    item.kind === "event" ? (
                      <EventRow key={item.key} row={item.row} />
                    ) : (
                      <StatusRow key={item.key} event={item.event} />
                    ),
                  )}
                </ol>
              </section>
            ))}
            {data?.hasMore && (
              <div className="pt-1 text-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-brand"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "Loading…" : moreFailed ? "Couldn’t load — retry" : "Show older"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** One action: who (avatar + name), what, the detail line, when. */
function EventRow({ row }: { row: EntityActivityRow }) {
  const name = row.actor?.name ?? "System";
  return (
    <li className="flex gap-2.5 rounded-md px-1.5 py-2 hover:bg-surface-2/60">
      <UserAvatar name={row.actor ? name : null} src={row.actor?.avatarUrl ?? null} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <bdi className="min-w-0 truncate text-xs font-medium text-ink">{name}</bdi>
          <time
            className="ml-auto shrink-0 text-[11px] text-ink-3 num"
            dateTime={row.at}
            title={dateTimeLabel(row.at)}
          >
            {relativeTime(row.at)}
          </time>
        </div>
        <p className="text-xs text-ink-2">
          {row.label}
          {row.about && (
            <>
              {" · "}
              <bdi className="font-mono text-[11px] text-ink-3">{row.about}</bdi>
            </>
          )}
        </p>
        {row.summary && <p className="mt-0.5 break-words text-[11px] text-ink-3">{row.summary}</p>}
      </div>
    </li>
  );
}

/** A derived line — nobody did it, the spend says it: no avatar, an icon. */
function StatusRow({ event }: { event: StatusEvent }) {
  const live = event.kind === "live";
  const Icon = live ? CirclePlay : CirclePause;
  const platform = platformLabel(event.platform);
  return (
    <li className="flex gap-2.5 rounded-md px-1.5 py-2">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden>
        <Icon className="h-4 w-4 text-ink-3" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-2">
          {live ? "Went live on " : "Stopped on "}
          {platform}
        </p>
        {event.lastSpend && (
          <p className="mt-0.5 text-[11px] text-ink-3">Last spend {event.lastSpend}</p>
        )}
      </div>
      {/* The day header already says when — no time column here. */}
    </li>
  );
}

/** The panel's shape while the first page loads — rows, not a spinner. */
function ActivitySkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading activity">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex gap-2.5 px-1.5">
          <div className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-surface-2" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 animate-pulse rounded bg-surface-2" />
            <div className="h-3 w-40 max-w-full animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}
