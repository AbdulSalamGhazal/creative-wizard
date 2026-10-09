"use client";

import { useState, useTransition } from "react";
import { SmilePlus } from "lucide-react";
import { toast } from "sonner";
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
import { toggleReaction } from "@/app/actions/comments";

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
 * A pill is a TOGGLE, not an add: clicking your own takes it back. The server
 * decides which way the click went (the unique key is the toggle), and the
 * thread reloads from `onChanged` rather than either piece guessing — one
 * source of truth, and a failed toggle can't leave a phantom pill behind.
 *
 * A soft-deleted comment renders neither piece: the caller doesn't mount them,
 * and the action refuses a reaction on a deleted comment anyway.
 */

/** The shared click: toggle on the server, then let the thread reload. */
function useToggleReaction(commentId: string, onChanged: () => void) {
  const [isPending, startTransition] = useTransition();
  const toggle = (kind: string, after?: () => void) => {
    startTransition(async () => {
      const res = await toggleReaction({ commentId, kind });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save that reaction.");
        return;
      }
      after?.();
      onChanged();
    });
  };
  return { isPending, toggle };
}

/** The add-reaction button + its five. Lives in the action row. */
export function ReactionPicker({
  commentId,
  reactions,
  onChanged,
}: {
  commentId: string;
  reactions: CommentReactionTally[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { isPending, toggle } = useToggleReaction(commentId, onChanged);
  const mineKinds = new Set(reactions.filter((r) => r.mine).map((r) => r.kind));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isPending}
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
              disabled={isPending}
              onClick={() => toggle(r.key, () => setOpen(false))}
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
  commentId,
  reactions,
  onChanged,
}: {
  commentId: string;
  reactions: CommentReactionTally[];
  onChanged: () => void;
}) {
  const { isPending, toggle } = useToggleReaction(commentId, onChanged);
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
          disabled={isPending}
          onClick={() => toggle(r.kind)}
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
