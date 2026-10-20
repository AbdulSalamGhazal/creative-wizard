"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  COMMENT_REACTIONS,
  reactionEmoji,
  reactionTooltip,
  type CommentReactionTally,
} from "@/lib/comments";
import { ReactionSync, applyReactionOverrides } from "@/lib/reaction-sync";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { setReaction } from "@/app/actions/comments";
import type { CommentRow } from "@/db/queries/comments";

/**
 * Reactions on a comment, in TWO pieces because they belong in two places —
 * the house order (and everyone else's): **body → action row → pills last**.
 *
 *   · `ReactionPicker` sits in the ACTION ROW beside Reply, so a comment has
 *     exactly one row of affordances rather than a widget wedged between the
 *     message and its own actions.
 *   · `ReactionPills` is the comment's CLOSING LINE — the tallies that exist,
 *     and nothing at all when there are none (an empty strip is a control
 *     pretending to be content).
 *
 * ONE COMPONENT FILE for both presentations: the docked panel and the phone
 * Sheet render the same thread, so this is written once and appears in both.
 *
 * OPTIMISTIC (2026-10). Both pieces are presentational; the state is ONE
 * `useCommentReactions` per thread, built on `ReactionSync` (lib/reaction-
 * sync.ts): a click changes the pill and its count AT ONCE, writes are
 * serialised per (comment, kind) so a burst of clicks ends in the state the
 * reader last chose, and a failure rolls the pill back with a toast. The
 * server is told the state the reader WANTS (`setReaction`), never "toggle".
 *
 * A soft-deleted comment renders neither piece: the caller doesn't mount them,
 * and the action refuses a reaction on a deleted comment anyway.
 */

/** How long the thread waits after the last write settles before reloading. */
const RELOAD_AFTER_MS = 300;

export interface CommentReactionsState {
  /** The tallies to SHOW for a comment — the server's, plus pending clicks. */
  tallies: (comment: CommentRow) => CommentReactionTally[];
  /** The reader clicked `kind` on `comment`: flip their reaction, now. */
  choose: (comment: CommentRow, kind: string) => void;
}

/**
 * ONE per thread. `onSettled` reloads the thread once the writes have landed
 * (debounced, so a burst across several pills reloads once), which is what
 * brings back other people's reactions and the tooltip names.
 */
export function useCommentReactions(
  comments: CommentRow[],
  onSettled: () => void,
): CommentReactionsState {
  const [, setVersion] = useState(0);
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);
  const timer = useRef<number | null>(null);

  const [sync] = useState(
    () =>
      new ReactionSync({
        send: (commentId, kind, on) => safeAction(() => setReaction({ commentId, kind, on })),
        onChange: () => setVersion((v) => v + 1),
        onError: (result) => toastActionFailure(result, "Couldn't save that reaction."),
        onSettled: () => {
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            timer.current = null;
            // Still writing somewhere? That write's own settle reloads.
            if (!sync.busy) settledRef.current();
          }, RELOAD_AFTER_MS);
        },
      }),
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  // Fresh tallies from the server: settled choices are in them now.
  useEffect(() => {
    sync.reconcile();
    setVersion((v) => v + 1);
  }, [comments, sync]);

  const tallies = useCallback(
    (comment: CommentRow) =>
      applyReactionOverrides(comment.reactions, sync.overridesFor(comment.id)),
    [sync],
  );

  const choose = useCallback(
    (comment: CommentRow, kind: string) => {
      const shown = tallies(comment).find((t) => t.kind === kind)?.mine ?? false;
      const serverMine = comment.reactions.find((t) => t.kind === kind)?.mine ?? false;
      sync.choose(comment.id, kind, !shown, serverMine);
    },
    [sync, tallies],
  );

  return { tallies, choose };
}

/** The add-reaction button + the vocabulary. Lives in the action row. */
export function ReactionPicker({
  reactions,
  onChoose,
}: {
  /** The tallies as SHOWN (pending clicks included), for the "yours" tint. */
  reactions: CommentReactionTally[];
  onChoose: (kind: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const mineKinds = new Set(reactions.filter((r) => r.mine).map((r) => r.kind));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add a reaction"
          className="inline-flex h-6 items-center rounded-md px-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <SmilePlus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-1">
        <div className="flex items-center gap-0.5">
          {COMMENT_REACTIONS.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => {
                // Close on the pick, not on the server's answer — the pill
                // below has already changed.
                setOpen(false);
                onChoose(r.key);
              }}
              aria-label={r.label}
              aria-pressed={mineKinds.has(r.key)}
              className={cn(
                "rounded-md px-1.5 py-1 text-base leading-none transition-colors hover:bg-surface-2",
                mineKinds.has(r.key) && "bg-[var(--brand-soft)]",
              )}
            >
              <span aria-hidden>{r.emoji}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The tallies, as toggle pills. Renders NOTHING when there are none. */
export function ReactionPills({
  reactions,
  onChoose,
}: {
  reactions: CommentReactionTally[];
  onChoose: (kind: string) => void;
}) {
  if (reactions.length === 0) return null;

  return (
    // The row sits inside an otherwise-clickable comment (clicking a comment
    // applies its view), so every click here stops there.
    <div
      className="mt-1 flex flex-wrap items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {reactions.map((r) => (
        <button
          key={r.kind}
          type="button"
          onClick={() => onChoose(r.kind)}
          title={reactionTooltip(r)}
          aria-label={reactionTooltip(r)}
          aria-pressed={r.mine}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none transition-colors",
            // Your own reaction is tinted — the pill answers "did I react?"
            // before you count anything.
            r.mine
              ? "border-brand/40 bg-[var(--brand-soft)] text-ink"
              : "border-line bg-surface-2 text-ink-2 hover:text-ink",
          )}
        >
          <span aria-hidden>{reactionEmoji(r.kind)}</span>
          <span className="num">{r.count}</span>
        </button>
      ))}
    </div>
  );
}
