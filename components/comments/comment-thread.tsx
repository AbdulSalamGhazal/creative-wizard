"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { dateTimeLabel, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  collapseReplies,
  newCommentIds,
  normalizeQuery,
  showViewChip,
} from "@/lib/comments";
import { deleteComment, restoreComment, updateComment } from "@/app/actions/comments";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { CommentBody } from "@/components/comments/comment-body";
import { CommentComposer } from "@/components/comments/comment-composer";
import {
  ReactionPicker,
  ReactionPills,
  useCommentReactions,
} from "@/components/comments/comment-reactions";
import { UserAvatar } from "@/components/user/user-avatar";
import type { CommentRow } from "@/db/queries/comments";

/**
 * A thread row as the panel holds it: a stored comment, or one of YOURS the
 * stored thread doesn't show yet — `pending` while on its way ("Sending…",
 * dimmed, no actions), then a plain row until a load shows the stored copy.
 */
export type ThreadComment = CommentRow & { pending?: boolean };

/** How long the Undo toast stays — and so how long a delete can be undone. */
const UNDO_MS = 8_000;

/**
 * The thread inside the panel — CHAT ORDER: oldest at the top, newest at the
 * bottom, replies inline under their root. A conversation reads downwards.
 *
 * THE ROW (2026-10-20, the Slack/Linear/GitHub shape): the author's avatar on
 * the leading side; a header of NAME · TIME (a `<time>` whose title is the
 * absolute date, the relative text refreshing each minute) · edited; the body
 * on its own line below. Replies indent with a smaller avatar. Headers are NOT
 * merged for consecutive messages by one author — threads here are short,
 * and every comment keeps its own time.
 *
 * READING (2026-10-20):
 *  - "NEW": a divider above the first comment by someone else posted since you
 *    last had this thread on screen, and a subtle tint on each new one.
 *  - LONG THREADS: more than two replies show the latest two and "Show N
 *    earlier replies"; a deep-linked or new reply in the hidden range forces it
 *    open. Long bodies clamp at ~6 lines with Show more / Show less — never
 *    the highlighted one.
 *
 * The headline mechanic: a comment that captured a view is CLICKABLE and
 * applies that view to the page beside the panel.
 *
 * Row actions are deliberately separated: Reply is the one visible action, and
 * Edit/Delete live behind a "…" menu — Delete never sits next to Reply, where a
 * slip would take a comment down. And Delete asks nothing first: it acts, then
 * offers Undo for a few seconds, which is safe because the delete is soft.
 */
export function CommentThread({
  comments,
  currentUserId,
  canModerate,
  currentQuery,
  highlightId,
  newSince,
  onApplyView,
  onReply,
  onChanged,
}: {
  comments: ThreadComment[];
  currentUserId: string | null;
  canModerate: boolean;
  /** The page's current query string, to decide whether a view differs. */
  currentQuery: string;
  highlightId: string | null;
  /** Where you last left this thread (null: a first visit, nothing is new). */
  newSince: Date | null;
  onApplyView: (comment: CommentRow) => void;
  /** Reply to THIS comment (the panel threads it under its root). */
  onReply: (comment: ThreadComment) => void;
  onChanged: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  /** Roots whose earlier replies the reader opened — for as long as the panel shows them. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const endRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  // "3m ago" stays true while the panel sits open — one interval per thread.
  useMinuteTick();
  // ONE reaction state for the whole thread: optimistic, serialised per
  // comment and kind, and it reloads the thread once its writes have landed.
  const reactions = useCommentReactions(comments, onChanged);

  const newIds = useMemo(
    () => newCommentIds(comments, newSince, currentUserId),
    [comments, newSince, currentUserId],
  );

  const roots = comments.filter((c) => c.parentId === null);
  const repliesOf = new Map<string, ThreadComment[]>();
  for (const c of comments) {
    if (c.parentId === null) continue;
    const list = repliesOf.get(c.parentId) ?? [];
    list.push(c);
    repliesOf.set(c.parentId, list);
  }

  // What must never hide behind "Show earlier replies": the deep-linked
  // comment and anything new.
  const mustShow = useMemo(() => {
    const ids = new Set(newIds);
    if (highlightId) ids.add(highlightId);
    return ids;
  }, [newIds, highlightId]);

  // The display, in order — and the FIRST new comment in it, which the "New"
  // divider sits above.
  const display = roots.map((root) => {
    const all = repliesOf.get(root.id) ?? [];
    const { hidden, shown } = collapseReplies(all, {
      expanded: expanded.has(root.id),
      mustShow,
    });
    return { root, hidden, shown };
  });
  const firstNewId =
    display
      .flatMap((d) => [d.root, ...d.shown])
      .find((c) => newIds.has(c.id))?.id ?? null;

  // Land where the conversation is: on the highlighted comment when one was
  // deep-linked (or clicked); otherwise at the "New" divider the first time
  // one appears; otherwise at the newest message. Only when something MOVES
  // the reader — the first load, a NEW comment, a new highlight, the divider
  // arriving — never on a reload that merely refreshed tallies: reacting to an
  // old comment must not yank the thread to its end.
  const seen = useRef<{ count: number; highlightId: string | null; firstNewId: string | null } | null>(
    null,
  );
  useEffect(() => {
    const prev = seen.current;
    seen.current = { count: comments.length, highlightId, firstNewId };
    if (comments.length === 0) return;
    const grew = prev === null || comments.length > prev.count;
    const newHighlight = highlightId !== null && highlightId !== prev?.highlightId;
    const dividerArrived = firstNewId !== null && (prev === null || prev.firstNewId === null);
    if (!grew && !newHighlight && !dividerArrived) return;

    // Scroll the PANEL's own box, never the window (ui-system invariant —
    // `scrollIntoView` moves every scrollable ancestor, the page included).
    const box = (highlightRef.current ?? dividerRef.current ?? endRef.current)?.closest<HTMLElement>(
      "[data-comment-scroll]",
    );
    if (!box) return;
    const reveal = (el: HTMLElement, at: number) => {
      const boxRect = box.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      box.scrollTop += rect.top - boxRect.top - (box.clientHeight - rect.height) * at;
    };
    if (highlightId && highlightRef.current) {
      reveal(highlightRef.current, 0.5);
    } else if (dividerRef.current && (dividerArrived || prev === null)) {
      // The divider a third of the way down: what's new below it, a little
      // of what you'd already read above.
      reveal(dividerRef.current, 0.3);
    } else if (grew) {
      box.scrollTop = box.scrollHeight;
    }
  }, [comments, highlightId, firstNewId]);

  const undo = async (id: string) => {
    const res = await safeAction(() => restoreComment({ id }));
    if (!res.ok) {
      toastActionFailure(res, "Couldn't restore that comment.");
      return;
    }
    onChanged();
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const res = await safeAction(() => deleteComment({ id }));
      if (!res.ok) {
        toastActionFailure(res, "Couldn't delete that comment.");
        return;
      }
      onChanged();
      // The toast IS the undo window. After it goes, the comment stays
      // soft-deleted — never lost, just not one click away any more.
      toast("Comment deleted", {
        duration: UNDO_MS,
        action: { label: "Undo", onClick: () => void undo(id) },
      });
    });
  };

  const renderOne = (comment: ThreadComment, isReply: boolean) => {
    const pending = comment.pending === true;
    const deleted = comment.deletedAt !== null;
    const mine = currentUserId !== null && comment.authorUserId === currentUserId;
    const canEdit = !pending && !deleted && mine;
    const canDelete = !pending && !deleted && (mine || canModerate);
    const hasView = !pending && !deleted && normalizeQuery(comment.viewQuery) !== "";
    const differs = !pending && !deleted && showViewChip(comment.viewQuery, currentQuery);
    const highlighted = highlightId === comment.id;
    const isNew = newIds.has(comment.id);
    const mentionNames = comment.mentions.map((m) => m.name ?? "");
    const shownReactions = reactions.tallies(comment);
    const created = comment.createdAt.toISOString();

    return (
      <Fragment key={comment.id}>
        {comment.id === firstNewId && (
          <div
            ref={dividerRef}
            role="separator"
            aria-label="New since your last visit"
            className="my-1 flex items-center gap-2 px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-brand"
          >
            <span className="h-px flex-1 bg-brand/40" aria-hidden />
            New
            <span className="h-px flex-1 bg-brand/40" aria-hidden />
          </div>
        )}
        <div
          id={`comment-${comment.id}`}
          ref={highlighted ? highlightRef : undefined}
          // The whole row is the target when there's a view to apply; rows
          // without one are inert, so nothing moves when you click them.
          onClick={hasView ? () => onApplyView(comment) : undefined}
          className={cn(
            "group flex gap-2 rounded-md px-2 py-2 transition-colors",
            isReply && "py-1.5",
            hasView && "cursor-pointer hover:bg-surface-2",
            isNew && !highlighted && "bg-[var(--brand-soft)]/40",
            highlighted && "bg-[var(--brand-soft)] ring-1 ring-brand",
            pending && "opacity-60",
          )}
          aria-busy={pending || undefined}
        >
          <UserAvatar
            name={comment.authorName}
            src={comment.authorAvatarUrl}
            size={isReply ? "sm" : "md"}
            className="mt-0.5"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-x-1.5">
              {/* <bdi>: an Arabic name keeps its own direction in the LTR
                  header without reordering the time beside it. */}
              <bdi className="min-w-0 truncate text-xs font-medium text-ink">
                {comment.authorName ?? "Former member"}
              </bdi>
              {pending ? (
                <span className="shrink-0 text-[10px] text-ink-3">Sending…</span>
              ) : (
                <time
                  dateTime={created}
                  title={dateTimeLabel(comment.createdAt)}
                  className="shrink-0 text-[10px] text-ink-3"
                >
                  {relativeTime(comment.createdAt)}
                </time>
              )}
              {comment.editedAt && !deleted && (
                <span className="shrink-0 text-[10px] text-ink-3">· edited</span>
              )}
              {differs && (
                <span
                  title="Click this comment to see the filters and range it was written under"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-3"
                >
                  <Eye className="h-3 w-3" aria-hidden />
                  <span className="sr-only">Has its own view — </span>
                  View
                </span>
              )}

              {(canEdit || canDelete) && editing !== comment.id && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="More actions"
                      className={cn(
                        "ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink",
                        // Revealed on hover or keyboard focus; ALWAYS shown on a
                        // touch screen, where there is no hover to reveal it.
                        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100",
                      )}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  {/* The menu is portaled, but React events still bubble up the
                      component tree — stop them before they reach the row's
                      click-to-apply handler. */}
                  <DropdownMenuContent align="end" className="w-36" onClick={(e) => e.stopPropagation()}>
                    {canEdit && (
                      <DropdownMenuItem onSelect={() => setEditing(comment.id)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </DropdownMenuItem>
                    )}
                    {canDelete && (
                      <DropdownMenuItem
                        onSelect={() => remove(comment.id)}
                        disabled={isPending}
                        className="text-neg focus:text-neg"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {deleted ? (
              <p className="mt-0.5 text-xs italic text-ink-3">Comment deleted</p>
            ) : editing === comment.id ? (
              // THE SAME COMPOSER as create and reply — which is why "@" works
              // here at all. It was a bare Textarea until 2026-10.
              <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                <CommentComposer
                  initialValue={comment.body}
                  initialMentions={comment.mentions
                    .filter((m) => m.name !== null)
                    .map((m) => ({ id: m.userId, name: m.name! }))}
                  rows={3}
                  autoFocus
                  submitLabel="Save"
                  ariaLabel="Edit comment"
                  placeholder="Edit your comment…"
                  onSubmit={(body, mentionUserIds) =>
                    updateComment({ id: comment.id, body, mentionUserIds })
                  }
                  onSubmitted={() => {
                    setEditing(null);
                    onChanged();
                  }}
                  onCancel={() => setEditing(null)}
                />
              </div>
            ) : (
              <ClampedBody
                body={comment.body}
                mentionNames={mentionNames}
                // The comment you were sent to is shown WHOLE.
                clampable={!highlighted}
              />
            )}

            {/* The house order, and everyone else's: body → ACTION ROW → the
                reaction pills as the comment's closing line. */}
            {!pending && !deleted && editing !== comment.id && (
              <>
                <div className="mt-0.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {/* Reply stays the one VISIBLE verb; Edit/Delete remain
                      behind the "…" menu above. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="-ml-1.5"
                    onClick={() => onReply(comment)}
                  >
                    Reply
                  </Button>
                  <ReactionPicker
                    reactions={shownReactions}
                    onChoose={(kind) => reactions.choose(comment, kind)}
                  />
                </div>
                <ReactionPills
                  reactions={shownReactions}
                  onChoose={(kind) => reactions.choose(comment, kind)}
                />
              </>
            )}
          </div>
        </div>
      </Fragment>
    );
  };

  if (roots.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-xs text-ink-3">
        No comments yet. Start one below.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {display.map(({ root, hidden, shown }) => (
        <div key={root.id} className="rounded-lg border border-line bg-surface p-1.5">
          {renderOne(root, false)}
          {(hidden > 0 || shown.length > 0) && (
            <div className="ml-5 space-y-0.5 border-l border-line pl-2">
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => new Set(prev).add(root.id))}
                  className="num px-2 py-1 text-[11px] text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  Show {hidden} earlier {hidden === 1 ? "reply" : "replies"}
                </button>
              )}
              {shown.map((reply) => renderOne(reply, true))}
            </div>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

/** About six lines of `text-sm` — where a long body clamps. */
const CLAMP_PX = 120;

/**
 * A comment body that clamps when it is long (2026-10-20): ~6 lines, then
 * "Show more" / "Show less". It measures rather than guesses — the toggle only
 * appears when the text really overflows — and the highlighted comment (the
 * one a notification sent you to) is never clamped.
 */
function ClampedBody({
  body,
  mentionNames,
  clampable,
}: {
  body: string;
  mentionNames: string[];
  clampable: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > CLAMP_PX + 4);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [body]);

  const clamped = clampable && overflows && !open;
  return (
    <div>
      <div
        ref={ref}
        style={
          clamped
            ? {
                maxHeight: CLAMP_PX,
                overflow: "hidden",
                maskImage: "linear-gradient(to bottom, black 70%, transparent)",
                WebkitMaskImage: "linear-gradient(to bottom, black 70%, transparent)",
              }
            : undefined
        }
      >
        <CommentBody body={body} mentionNames={mentionNames} className="comment-body text-sm text-ink-2" />
      </div>
      {clampable && overflows && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          className="mt-0.5 text-[11px] text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
