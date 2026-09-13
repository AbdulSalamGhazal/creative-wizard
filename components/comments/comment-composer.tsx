"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  COMMENT_MAX,
  activeMentions,
  detectMentionQuery,
  insertMentionToken,
  matchMembers,
  type CommentAnchorType,
  type MentionQuery,
} from "@/lib/comments";
import { createComment } from "@/app/actions/comments";

interface Member {
  id: string;
  name: string;
  email?: string | null;
}

/**
 * The composer: a body, INLINE @ mentions, and — the point of the whole
 * feature — the VIEW captured at post time.
 *
 * Typing "@" (at the start, or after a space) opens the member list right
 * above the composer; typing on filters it by name or email; ↑/↓ move, Enter or
 * Tab inserts "@Name" and registers the mention, Escape closes and leaves the
 * "@" as plain text. Mentions still travel as explicit ids — the text is never
 * parsed at submit — and a name deleted from the body before posting is simply
 * not sent.
 *
 * The capture reads the LIVE location when Post is pressed, not when the panel
 * rendered: what the reader was looking at when they hit Post is what the
 * comment is about.
 */
export function CommentComposer({
  anchorType,
  anchorId,
  parentId = null,
  placeholder = "Write a comment…",
  autoFocus = false,
  onPosted,
  onCancel,
}: {
  anchorType: CommentAnchorType;
  anchorId: string;
  parentId?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  onPosted?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<Member[]>([]);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [token, setToken] = useState<MentionQuery | null>(null);
  /** The "@" position Escape dismissed — stays closed until you leave it. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const pickerOpen = token !== null && token.start !== dismissedAt;
  const matches = matchMembers(members ?? [], token?.query ?? "");

  // The member list is fetched the first time a picker opens — no page pays
  // for it up front.
  useEffect(() => {
    if (!pickerOpen || members !== null) return;
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/brand-members", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { members: Member[] };
        if (live) setMembers(data.members ?? []);
      } catch {
        if (live) setMembers([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [pickerOpen, members]);

  /** Re-read the "@query" under the caret after any edit or caret move. */
  const syncToken = (text: string, caret: number) => {
    const next = detectMentionQuery(text, caret);
    setToken(next);
    if (!next) setDismissedAt(null);
    if (next?.query !== token?.query) setCursor(0);
  };

  const pick = (member: Member) => {
    const el = textareaRef.current;
    if (!token || !el) return;
    const caret = el.selectionStart ?? body.length;
    const next = insertMentionToken(body, token, caret, member.name);
    setBody(next.text.slice(0, COMMENT_MAX));
    setMentions((list) =>
      list.some((m) => m.id === member.id) ? list : [...list, member],
    );
    setToken(null);
    setCursor(0);
    // Put the caret after the inserted name once React has written the value.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  /** The secondary button: drop an "@" at the caret, which opens the picker. */
  const startMention = () => {
    const el = textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? body.length;
    const needsSpace = caret > 0 && !/\s/.test(body[caret - 1] ?? "");
    const inserted = `${needsSpace ? " " : ""}@`;
    const text = body.slice(0, caret) + inserted + body.slice(caret);
    const nextCaret = caret + inserted.length;
    setBody(text);
    syncToken(text, nextCaret);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const post = () => {
    const text = body.trim();
    if (!text) return;
    const search =
      typeof window === "undefined" ? "" : window.location.search.replace(/^\?/, "");

    startTransition(async () => {
      const res = await createComment({
        anchorType,
        anchorId,
        parentId,
        body: text,
        viewQuery: search,
        // Only the mentions whose "@Name" survived editing actually count.
        mentionUserIds: activeMentions(text, mentions).map((m) => m.id),
      });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't post that comment.");
        return;
      }
      setBody("");
      setMentions([]);
      setToken(null);
      onPosted?.();
      router.refresh();
    });
  };

  const remaining = COMMENT_MAX - body.length;

  return (
    <div className="space-y-2">
      <Popover
        open={pickerOpen}
        onOpenChange={(next) => {
          if (!next && token) setDismissedAt(token.start);
        }}
      >
        <PopoverAnchor asChild>
          <div ref={anchorRef}>
            <Textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => {
                const text = e.target.value.slice(0, COMMENT_MAX);
                setBody(text);
                syncToken(text, e.target.selectionStart ?? text.length);
              }}
              onSelect={(e) =>
                syncToken(body, e.currentTarget.selectionStart ?? body.length)
              }
              placeholder={placeholder}
              autoFocus={autoFocus}
              rows={parentId ? 2 : 3}
              className="min-h-16 text-sm"
              aria-label={parentId ? "Write a reply" : "Write a comment"}
              aria-expanded={pickerOpen}
              aria-autocomplete="list"
              onKeyDown={(e) => {
                if (pickerOpen) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCursor((c) => Math.min(Math.max(0, matches.length - 1), c + 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCursor((c) => Math.max(0, c - 1));
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    const chosen = matches[cursor];
                    if (chosen) {
                      e.preventDefault();
                      pick(chosen);
                      return;
                    }
                  }
                  if (e.key === "Escape") {
                    // Close the picker, keep the literal "@", and don't let
                    // the Escape travel on to close the panel.
                    e.preventDefault();
                    e.stopPropagation();
                    if (token) setDismissedAt(token.start);
                    return;
                  }
                }
                // Enter posts, Shift+Enter breaks the line — the convention
                // every chat surface uses.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  post();
                }
                if (e.key === "Escape" && onCancel) onCancel();
              }}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          className="w-64 p-0"
          // Focus stays in the textarea: the list is driven from the keyboard
          // there, and typing must keep filtering it.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
        >
          <ul className="max-h-56 overflow-y-auto py-1" role="listbox" aria-label="Mention someone">
            {members === null ? (
              <li className="px-3 py-2 text-xs text-ink-3">Loading…</li>
            ) : matches.length === 0 ? (
              <li className="px-3 py-2 text-xs text-ink-3">
                Nobody matches — only people with access to this brand can be
                mentioned. Esc keeps the &ldquo;@&rdquo; as text.
              </li>
            ) : (
              matches.map((m, i) => (
                <li key={m.id} role="option" aria-selected={i === cursor}>
                  <button
                    type="button"
                    // mousedown, not click: keep the textarea's focus and caret.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(m);
                    }}
                    onMouseEnter={() => setCursor(i)}
                    className={cn(
                      "flex w-full flex-col px-3 py-1.5 text-left text-xs text-ink-2 hover:text-ink",
                      i === cursor && "bg-surface-2 text-ink",
                    )}
                  >
                    <span>{m.name}</span>
                    {m.email && <span className="text-[10px] text-ink-3">{m.email}</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
        </PopoverContent>
      </Popover>

      <div className="flex flex-wrap items-center gap-2">
        {/* Secondary now: typing "@" is the primary way in. The button just
            types the "@" for you. */}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={startMention}
          className="text-ink-3"
        >
          <AtSign className="h-3 w-3" />
          Mention
        </Button>

        {activeMentions(body, mentions).length > 0 && (
          <span className="min-w-0 truncate text-[11px] text-ink-3">
            Notifying {activeMentions(body, mentions).map((m) => m.name).join(", ")}
          </span>
        )}

        <span className="ml-auto flex items-center gap-2">
          {remaining < 200 && (
            <span className={cn("num text-[11px]", remaining < 0 ? "text-warn" : "text-ink-3")}>
              {remaining}
            </span>
          )}
          {onCancel && (
            <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            type="button"
            size="xs"
            onClick={post}
            disabled={body.trim() === "" || isPending}
          >
            <Send className="h-3 w-3" />
            {parentId ? "Reply" : "Post"}
          </Button>
        </span>
      </div>
    </div>
  );
}
