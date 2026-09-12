"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CommentPanel } from "@/components/comments/comment-panel";
import { isCommentableView, viewLabel } from "@/lib/comments";
import type { CommentRow } from "@/db/queries/comments";

interface WireComment extends Omit<CommentRow, "createdAt" | "editedAt" | "deletedAt"> {
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

/**
 * The Comments button + side sheet for AGGREGATE pages ("view" anchors).
 *
 * The thread loads when the sheet OPENS, not when the page renders: most
 * visits to a dashboard never open it, and a page that already runs a dozen
 * analytical queries shouldn't add one more for a panel nobody looked at. The
 * count in the badge is the one thing rendered server-side.
 */
export function CommentSheet({
  count,
  currentUserId,
  canModerate,
}: {
  count: number;
  currentUserId: string | null;
  canModerate: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CommentRow[] | null>(null);

  const load = useCallback(async () => {
    if (!isCommentableView(pathname)) return;
    try {
      const params = new URLSearchParams({ anchorType: "view", anchorId: pathname });
      const res = await fetch(`/api/comments?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { comments: WireComment[] };
      // Dates cross the wire as strings; the panel wants Dates.
      setRows(
        (data.comments ?? []).map((c) => ({
          ...c,
          createdAt: new Date(c.createdAt),
          editedAt: c.editedAt ? new Date(c.editedAt) : null,
          deletedAt: c.deletedAt ? new Date(c.deletedAt) : null,
        })),
      );
    } catch {
      setRows([]);
    }
  }, [pathname]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Not an allow-listed page: render nothing rather than a button that would
  // be refused on post.
  if (!isCommentableView(pathname)) return null;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <MessageSquare className="h-3.5 w-3.5" />
        Comments
        {count > 0 && <span className="num ml-1 text-[11px] text-ink-3">{count}</span>}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Comments on {viewLabel(pathname) ?? "this page"}</SheetTitle>
            <SheetDescription>
              Posting captures the filters and range you have on screen right now,
              so whoever you mention sees what you see.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {rows === null ? (
              <p className="py-8 text-center text-xs text-ink-3">Loading…</p>
            ) : (
              <CommentPanel
                anchorType="view"
                anchorId={pathname}
                comments={rows}
                currentUserId={currentUserId}
                canModerate={canModerate}
                onChanged={() => void load()}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
