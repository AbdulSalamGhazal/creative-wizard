"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Eye, Pencil, Reply, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/format";
import { useNavTransition } from "@/lib/nav-progress";
import { cn } from "@/lib/utils";
import {
  COMMENT_MAX,
  highlightMentions,
  showViewChip,
  type CommentAnchorType,
} from "@/lib/comments";
import { CommentComposer } from "@/components/comments/comment-composer";
import { deleteComment, updateComment } from "@/app/actions/comments";
import type { CommentRow } from "@/db/queries/comments";

/**
 * The one comment surface — used inline on entity pages and inside the sheet on
 * aggregate pages, so a conversation reads the same wherever it lives.
 *
 * Threads are FLAT by construction (the server re-parents a reply-to-a-reply),
 * so this renders exactly two levels and never recurses.
 */
export function CommentPanel({
  anchorType,
  anchorId,
  comments,
  currentUserId,
  canModerate,
  onChanged,
}: {
  anchorType: CommentAnchorType;
  anchorId: string;
  comments: CommentRow[];
  currentUserId: string | null;
  /** Admins may delete anyone's comment; everyone may delete their own. */
  canModerate: boolean;
  /** Called after a write, so a lazily-loaded sheet can refetch. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useNavTransition();
  const [isPending, startTransition] = useTransition();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const currentQuery = searchParams.toString();

  const { roots, repliesOf } = useMemo(() => {
    const rootRows = comments.filter((c) => c.parentId === null);
    const map = new Map<string, CommentRow[]>();
    for (const c of comments) {
      if (c.parentId === null) continue;
      const list = map.get(c.parentId) ?? [];
      list.push(c);
      map.set(c.parentId, list);
    }
    // Newest thread first; inside a thread, oldest first — a conversation
    // reads forwards.
    rootRows.sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf());
    return { roots: rootRows, repliesOf: map };
  }, [comments]);

  // Arriving from a notification: scroll the comment into view and flash it,
  // so "someone replied" lands on the reply and not just the page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash.startsWith("#comment-")) return;
    const id = hash.slice("#comment-".length);
    if (!comments.some((c) => c.id === id)) return;
    const el = document.getElementById(`comment-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(id);
    const timer = window.setTimeout(() => setHighlighted(null), 2400);
    return () => window.clearTimeout(timer);
  }, [comments]);

  const afterWrite = () => {
    onChanged?.();
    router.refresh();
  };

  const saveEdit = (id: string) => {
    startTransition(async () => {
      const res = await updateComment({ id, body: draft.trim() });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save that edit.");
        return;
      }
      setEditing(null);
      afterWrite();
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const res = await deleteComment({ id });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't delete that comment.");
        return;
      }
      afterWrite();
    });
  };

  /** Jump to the exact view the comment was written in. */
  const openView = (query: string) => {
    startNav(() => router.push(`${pathname}?${query}`, { scroll: false }));
  };

  const renderOne = (comment: CommentRow, isReply: boolean) => {
    const deleted = comment.deletedAt !== null;
    const mine = currentUserId !== null && comment.authorUserId === currentUserId;
    const segments = highlightMentions(
      comment.body,
      comment.mentions.map((m) => m.name ?? ""),
    );
    const chip = !deleted && showViewChip(comment.viewQuery, currentQuery);

    return (
      <div
        key={comment.id}
        id={`comment-${comment.id}`}
        className={cn(
          "rounded-md px-2 py-2 transition-colors",
          isReply && "border-l border-line pl-3",
          highlighted === comment.id && "bg-[var(--brand-soft)] ring-1 ring-brand",
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
          {chip && (
            <button
              type="button"
              onClick={() => openView(comment.viewQuery!)}
              title="Show the filters and range this was written under"
              className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3 hover:text-ink"
            >
              <Eye className="h-3 w-3" />
              Open this view
            </button>
          )}
        </div>

        {deleted ? (
          <p className="mt-1 text-xs italic text-ink-3">Comment deleted</p>
        ) : editing === comment.id ? (
          <div className="mt-1 space-y-2">
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
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setEditing(null)}
              >
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
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() =>
                setReplyTo(replyTo === comment.id ? null : (comment.parentId ?? comment.id))
              }
            >
              <Reply className="h-3 w-3" />
              Reply
            </Button>
            {mine && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  setEditing(comment.id);
                  setDraft(comment.body);
                }}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
            )}
            {(mine || canModerate) && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={isPending}
                onClick={() => remove(comment.id)}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <CommentComposer
        anchorType={anchorType}
        anchorId={anchorId}
        onPosted={afterWrite}
      />

      {roots.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-xs text-ink-3">
          No comments yet. Mention someone with @ to bring them in — a comment
          with no mention notifies nobody.
        </p>
      ) : (
        <ul className="space-y-3">
          {roots.map((root) => {
            const replies = repliesOf.get(root.id) ?? [];
            const replyOpen = replyTo === root.id;
            return (
              <li key={root.id} className="rounded-lg border border-line bg-surface p-2">
                {renderOne(root, false)}
                {replies.length > 0 && (
                  <div className="mt-1 space-y-1 pl-2">
                    {replies.map((reply) => renderOne(reply, true))}
                  </div>
                )}
                {replyOpen && (
                  <div className="mt-2 pl-2">
                    <CommentComposer
                      anchorType={anchorType}
                      anchorId={anchorId}
                      parentId={root.id}
                      placeholder="Write a reply…"
                      autoFocus
                      onPosted={() => {
                        setReplyTo(null);
                        afterWrite();
                      }}
                      onCancel={() => setReplyTo(null)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
