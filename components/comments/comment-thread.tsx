"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  COMMENT_MAX,
  highlightMentions,
  normalizeQuery,
  showViewChip,
} from "@/lib/comments";
import { deleteComment, restoreComment, updateComment } from "@/app/actions/comments";
import type { CommentRow } from "@/db/queries/comments";

/** How long the Undo toast stays — and so how long a delete can be undone. */
const UNDO_MS = 8_000;

/**
 * The thread inside the panel — CHAT ORDER: oldest at the top, newest at the
 * bottom, replies inline under their root, and the list scrolled to the end on
 * open. A conversation reads downwards.
 *
 * The headline mechanic lives here: a comment that captured a view is CLICKABLE
 * and applies that view to the page beside the panel. Two comments written
 * under different filters become two buttons for two states of the page.
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
  onApplyView,
  onReply,
  onChanged,
}: {
  comments: CommentRow[];
  currentUserId: string | null;
  canModerate: boolean;
  /** The page's current query string, to decide whether a view differs. */
  currentQuery: string;
  highlightId: string | null;
  onApplyView: (comment: CommentRow) => void;
  onReply: (rootId: string) => void;
  onChanged: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  // Land where the conversation is: on the highlighted comment when one was
  // deep-linked, otherwise at the newest message.
  useEffect(() => {
    if (comments.length === 0) return;
    const target = highlightId ? highlightRef.current : endRef.current;
    target?.scrollIntoView({ block: highlightId ? "center" : "end" });
  }, [comments, highlightId]);

  const roots = comments.filter((c) => c.parentId === null);
  const repliesOf = new Map<string, CommentRow[]>();
  for (const c of comments) {
    if (c.parentId === null) continue;
    const list = repliesOf.get(c.parentId) ?? [];
    list.push(c);
    repliesOf.set(c.parentId, list);
  }

  const saveEdit = (id: string) => {
    startTransition(async () => {
      const res = await updateComment({ id, body: draft.trim() });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save that edit.");
        return;
      }
      setEditing(null);
      onChanged();
    });
  };

  const undo = async (id: string) => {
    const res = await restoreComment({ id });
    if (!res.ok) {
      toast.error(res.error ?? "Couldn't restore that comment.");
      return;
    }
    onChanged();
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const res = await deleteComment({ id });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't delete that comment.");
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

  const renderOne = (comment: CommentRow, isReply: boolean) => {
    const deleted = comment.deletedAt !== null;
    const mine = currentUserId !== null && comment.authorUserId === currentUserId;
    const canEdit = !deleted && mine;
    const canDelete = !deleted && (mine || canModerate);
    const hasView = !deleted && normalizeQuery(comment.viewQuery) !== "";
    const differs = !deleted && showViewChip(comment.viewQuery, currentQuery);
    const highlighted = highlightId === comment.id;
    const segments = highlightMentions(
      comment.body,
      comment.mentions.map((m) => m.name ?? ""),
    );

    return (
      <div
        key={comment.id}
        id={`comment-${comment.id}`}
        ref={highlighted ? highlightRef : undefined}
        // The whole row is the target when there's a view to apply; rows
        // without one are inert, so nothing moves when you click them.
        onClick={hasView ? () => onApplyView(comment) : undefined}
        className={cn(
          "group rounded-md px-2 py-2 transition-colors",
          isReply && "border-l border-line pl-3",
          hasView && "cursor-pointer hover:bg-surface-2",
          highlighted && "bg-[var(--brand-soft)] ring-1 ring-brand",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs font-medium text-ink">
            {comment.authorName ?? "Former member"}
          </span>
          <span className="text-[11px] text-ink-3">{relativeTime(comment.createdAt)}</span>
          {comment.editedAt && !deleted && (
            <span className="text-[11px] text-ink-3">· edited</span>
          )}
          {differs && (
            <span
              title="Click this comment to see the filters and range it was written under"
              className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3"
            >
              <Eye className="h-3 w-3" />
              Open this view
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
                    "ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink",
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
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(comment.id);
                      setDraft(comment.body);
                    }}
                  >
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
          <p className="mt-1 text-xs italic text-ink-3">Comment deleted</p>
        ) : editing === comment.id ? (
          <div className="mt-1 space-y-2" onClick={(e) => e.stopPropagation()}>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, COMMENT_MAX))}
              rows={3}
              className="text-sm"
              aria-label="Edit comment"
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="xs"
                disabled={draft.trim() === "" || isPending}
                onClick={() => saveEdit(comment.id)}
              >
                Save
              </Button>
              <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">
            {segments.map((seg, i) =>
              seg.mention ? (
                <span key={i} className="rounded-sm bg-[var(--brand-soft)] px-1 text-ink">
                  {seg.text}
                </span>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
          </p>
        )}

        {!deleted && editing !== comment.id && (
          // Reply is the ONLY visible action; it stays live inside an
          // otherwise-clickable row.
          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onReply(comment.parentId ?? comment.id)}
            >
              Reply
            </Button>
          </div>
        )}
      </div>
    );
  };

  if (roots.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-xs text-ink-3">
        No comments here yet. Whatever you post remembers the filters you have on
        screen — and only a mention or a reply notifies anyone.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {roots.map((root) => (
        <div key={root.id} className="rounded-lg border border-line bg-surface p-2">
          {renderOne(root, false)}
          {(repliesOf.get(root.id) ?? []).length > 0 && (
            <div className="mt-1 space-y-1 pl-2">
              {(repliesOf.get(root.id) ?? []).map((reply) => renderOne(reply, true))}
            </div>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
