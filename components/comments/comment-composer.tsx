"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { COMMENT_MAX, type CommentAnchorType } from "@/lib/comments";
import { createComment } from "@/app/actions/comments";

interface Member {
  id: string;
  name: string;
}

/**
 * The composer: a body, an @ picker, and — the point of the whole feature — the
 * VIEW captured at post time.
 *
 * The capture reads the LIVE location when Post is pressed, not when the panel
 * rendered: the reader was probably changing filters while typing, and what
 * they were looking at when they hit Post is what the comment is about.
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const matches = (members ?? []).filter((m) =>
    m.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const addMention = (member: Member) => {
    setMentions((list) =>
      list.some((m) => m.id === member.id) ? list : [...list, member],
    );
    // The text carries the name so the sentence reads naturally; the ID is
    // what actually notifies (mentions are stored explicitly, never parsed).
    setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${member.name} `);
    setPickerOpen(false);
    setFilter("");
    setCursor(0);
    textareaRef.current?.focus();
  };

  const post = () => {
    const text = body.trim();
    if (!text) return;
    // Only the mentions whose name survived editing actually count.
    const used = mentions.filter((m) => text.includes(`@${m.name}`));
    const search =
      typeof window === "undefined" ? "" : window.location.search.replace(/^\?/, "");

    startTransition(async () => {
      const res = await createComment({
        anchorType,
        anchorId,
        parentId,
        body: text,
        viewQuery: search,
        mentionUserIds: used.map((m) => m.id),
      });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't post that comment.");
        return;
      }
      setBody("");
      setMentions([]);
      onPosted?.();
      router.refresh();
    });
  };

  const remaining = COMMENT_MAX - body.length;

  return (
    <div className="space-y-2">
      <Textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, COMMENT_MAX))}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={parentId ? 2 : 3}
        className="min-h-16 text-sm"
        aria-label={parentId ? "Write a reply" : "Write a comment"}
        onKeyDown={(e) => {
          // Enter posts, Shift+Enter breaks the line — the convention every
          // chat surface uses.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            post();
          }
          if (e.key === "Escape" && onCancel) onCancel();
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="xs">
              <AtSign className="h-3 w-3" />
              Mention
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-60 p-0">
            <div className="border-b border-line p-2">
              <Input
                value={filter}
                autoFocus
                onChange={(e) => {
                  setFilter(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCursor((c) => Math.min(matches.length - 1, c + 1));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCursor((c) => Math.max(0, c - 1));
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const picked = matches[cursor];
                    if (picked) addMention(picked);
                  }
                }}
                placeholder="Search people"
                className="h-8"
                aria-label="Search people to mention"
              />
            </div>
            <ul className="max-h-56 overflow-y-auto py-1" role="listbox">
              {members === null ? (
                <li className="px-3 py-2 text-xs text-ink-3">Loading…</li>
              ) : matches.length === 0 ? (
                <li className="px-3 py-2 text-xs text-ink-3">
                  Nobody matches — only people with access to this brand can be
                  mentioned.
                </li>
              ) : (
                matches.map((m, i) => (
                  <li key={m.id} role="option" aria-selected={i === cursor}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => addMention(m)}
                      className={cn(
                        "w-full px-3 py-1.5 text-left text-xs text-ink-2 hover:text-ink",
                        i === cursor && "bg-surface-2 text-ink",
                      )}
                    >
                      {m.name}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </PopoverContent>
        </Popover>

        {mentions.length > 0 && (
          <span className="text-[11px] text-ink-3">
            Notifying {mentions.map((m) => m.name).join(", ")}
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
