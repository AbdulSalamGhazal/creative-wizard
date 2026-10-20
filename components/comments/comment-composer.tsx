"use client";

import { useEffect, useRef, useState } from "react";
import { AtSign, Bold, Italic, List, Send } from "lucide-react";
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
  composerStateAfterSubmit,
  detectMentionQuery,
  enterSubmits,
  insertMentionToken,
  isImeKeydown,
  matchMembers,
  type MentionQuery,
} from "@/lib/comments";
import { applyMarkdownTool, type MarkdownTool } from "@/lib/comment-markdown";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";

export interface ComposerMember {
  id: string;
  name: string;
  email?: string | null;
}

export interface ComposerResult {
  ok: boolean;
  error?: string;
}

/**
 * THE ONE COMPOSER — create, reply AND edit (2026-10).
 *
 * It used to be the create/reply composer only, and the edit path was a bare
 * `<Textarea>` beside it. That is why typing "@" while editing did nothing: the
 * picker, the keyboard handling and the mention registration all lived here,
 * and the edit path had none of them. The fix is STRUCTURAL — one component,
 * three callers — rather than a second copy of the wiring that would drift
 * again. The caller supplies the starting value, the submit label and what
 * submitting MEANS; everything about editing text is in here.
 *
 * Typing "@" (at the start, or after a space) opens the member list right
 * above the composer; typing on filters it by name or email; ↑/↓ move, Enter or
 * Tab inserts "@Name" and registers the mention, Escape closes and leaves the
 * "@" as plain text. Mentions travel as explicit ids — the text is never
 * parsed at submit — and a name deleted from the body before submitting is
 * simply not sent. On an EDIT the caller seeds the mentions already recorded,
 * so the same rules decide what survives.
 *
 * MARKDOWN-LITE: the toolbar inserts the syntax (**bold**, *italic*, "- "
 * lists) around the selection; ⌘/Ctrl+B and ⌘/Ctrl+I do the same from the
 * keyboard. The body is stored as PLAIN TEXT — rendering is
 * `lib/comment-markdown.ts`'s job, and nothing here ever produces HTML.
 */
export function CommentComposer({
  initialValue = "",
  initialMentions = [],
  placeholder = "Write a comment…",
  autoFocus = false,
  rows = 3,
  submitLabel = "Post",
  ariaLabel = "Write a comment",
  onSubmit,
  onSubmitted,
  onCancel,
}: {
  /** The text to start from — "" to create, the stored body to edit. */
  initialValue?: string;
  /** Mentions already recorded (edit), so removing one is detectable. */
  initialMentions?: ComposerMember[];
  placeholder?: string;
  autoFocus?: boolean;
  rows?: number;
  submitLabel?: string;
  ariaLabel?: string;
  /** What submitting means. The composer owns the text; the caller owns the verb. */
  onSubmit: (body: string, mentionUserIds: string[]) => Promise<ComposerResult>;
  /** Ran after a successful submit (clear, close, refresh — the caller's call). */
  onSubmitted?: () => void;
  onCancel?: () => void;
}) {
  /** A submit is on its way — the button shows it; the ref below guards it. */
  const [submitting, setSubmitting] = useState(false);
  /**
   * ONE submit at a time (2026-10). Enter used to post again while the first
   * post was still in flight (only the button was disabled), and the state
   * flag alone can't stop two Enters landing before React re-renders — a ref
   * flips synchronously.
   */
  const inFlight = useRef(false);
  const [body, setBody] = useState(initialValue);
  const [mentions, setMentions] = useState<ComposerMember[]>(initialMentions);
  const [members, setMembers] = useState<ComposerMember[] | null>(null);
  /** The member list failed to load — the picker says so and offers Retry. */
  const [membersError, setMembersError] = useState(false);
  /** Bumped by Retry; the fetch below runs once per attempt. */
  const [membersAttempt, setMembersAttempt] = useState(0);
  const membersLoading = useRef(false);
  const [token, setToken] = useState<MentionQuery | null>(null);
  /** The "@" position Escape dismissed — stays closed until you leave it. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const pickerOpen = token !== null && token.start !== dismissedAt;
  const matches = matchMembers(members ?? [], token?.query ?? "");

  // The member list is fetched the first time a picker opens — no page pays
  // for it up front. It FINISHES even if the picker closes meanwhile (typing a
  // space before it lands closes the token, and a cancelled fetch used to
  // leave the list unloaded for good), and a failure is an ERROR STATE with a
  // retry — it used to read "Loading…" forever on a non-OK response.
  useEffect(() => {
    if (!pickerOpen || members !== null || membersError || membersLoading.current) return;
    membersLoading.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/brand-members", { cache: "no-store" });
        if (!res.ok) throw new Error(`brand-members ${res.status}`);
        const data = (await res.json()) as { members?: ComposerMember[] };
        // No per-run cancel flag on purpose — see above. Setting state on an
        // unmounted composer is a no-op in React 18+.
        setMembers(data.members ?? []);
      } catch {
        setMembersError(true);
      } finally {
        membersLoading.current = false;
      }
    })();
    // `membersAttempt` re-arms the fetch after Retry.
  }, [pickerOpen, members, membersError, membersAttempt]);

  /** Re-read the "@query" under the caret after any edit or caret move. */
  const syncToken = (text: string, caret: number) => {
    // A token may run through spaces ("@Ann Lee") for as long as somebody
    // still matches it; while the list is loading (`null`) it stays open, and
    // the effect below re-reads it when the list lands.
    const next = detectMentionQuery(text, caret, members);
    setToken(next);
    if (!next) setDismissedAt(null);
    if (next?.query !== token?.query) setCursor(0);
  };

  // The list just arrived: re-read the token under the caret — a name typed
  // with a space while it loaded can be a mention again now.
  useEffect(() => {
    if (members === null) return;
    const el = textareaRef.current;
    if (!el || document.activeElement !== el) return;
    syncToken(el.value, el.selectionStart ?? el.value.length);
    // Only on arrival — syncToken is re-created every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  /** Toolbar + shortcut: insert markdown syntax around the selection. */
  const applyTool = (tool: MarkdownTool) => {
    const el = textareaRef.current;
    if (!el) return;
    const next = applyMarkdownTool(
      body,
      el.selectionStart ?? body.length,
      el.selectionEnd ?? body.length,
      tool,
    );
    setBody(next.text.slice(0, COMMENT_MAX));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  };

  const pick = (member: ComposerMember) => {
    const el = textareaRef.current;
    if (!token || !el) return;
    const caret = el.selectionStart ?? body.length;
    const next = insertMentionToken(body, token, caret, member.name);
    setBody(next.text.slice(0, COMMENT_MAX));
    setMentions((list) =>
      list.some((m) => m.id === member.id) ? list : [...list, member],
    );
    setToken(null);
    // The inserted "@Name " would match its own name again (tokens run
    // through spaces now): this "@" is done — keep its picker closed.
    setDismissedAt(token.start);
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

  const submit = async () => {
    const text = body.trim();
    if (!text || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      // NOT inside a transition: the caller may put something on screen the
      // moment it is asked (the panel's pending row), and an update made
      // inside an async transition would only commit when the whole call
      // finishes.
      //
      // `safeAction`: a call that REJECTS (network blink, a tab from before
      // the last deploy) resolves to a failure like any other — never an
      // unhandled rejection, never the route's error boundary.
      const res = await safeAction(() =>
        onSubmit(
          text,
          activeMentions(text, mentions).map((m) => m.id),
        ),
      );
      // THE COMPOSER CLEANS ITS OWN STATE. The drawer's create composer stays
      // MOUNTED after a post (its `key` only changes when `replyTo` does), so
      // without this the sent text sat in the box; reply and edit only looked
      // right because those instances unmount. Fixing it per-caller with a key
      // trick would leave the next caller to rediscover the same bug. A FAILED
      // submit keeps every character — `composerStateAfterSubmit` holds that
      // asymmetry, and a test pins both halves.
      const next = composerStateAfterSubmit(res, { body, mentions });
      setBody(next.body);
      setMentions(next.mentions);
      if (!res.ok) {
        toastActionFailure(res, "Couldn't save that.");
        return;
      }
      setToken(null);
      setDismissedAt(null);
      onSubmitted?.();
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
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
              rows={rows}
              className="min-h-16 text-sm"
              aria-label={ariaLabel}
              aria-expanded={pickerOpen}
              aria-autocomplete="list"
              onKeyDown={(e) => {
                // An IME is mid-composition (Japanese, Chinese, Korean…): its
                // Enter confirms the candidate — it is not ours to act on.
                if (isImeKeydown({ isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) {
                  return;
                }
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
                // ⌘/Ctrl+B and ⌘/Ctrl+I, the shortcuts every editor has.
                if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "i")) {
                  e.preventDefault();
                  applyTool(e.key === "b" ? "bold" : "italic");
                  return;
                }
                // Enter submits, Shift+Enter breaks the line — the convention
                // every chat surface uses.
                if (
                  enterSubmits({
                    key: e.key,
                    shiftKey: e.shiftKey,
                    isComposing: e.nativeEvent.isComposing,
                    keyCode: e.keyCode,
                  })
                ) {
                  e.preventDefault();
                  void submit();
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
            {membersError ? (
              <li className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-ink-3">
                <span>Couldn&rsquo;t load the people you can mention.</span>
                <button
                  type="button"
                  // mousedown, not click: keep the textarea's focus and caret.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setMembersError(false);
                    setMembersAttempt((n) => n + 1);
                  }}
                  className="shrink-0 rounded px-1.5 py-0.5 text-brand hover:underline"
                >
                  Retry
                </button>
              </li>
            ) : members === null ? (
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
        {/* The tools INSERT SYNTAX — they never switch the field into a rich
            editor. What you see in the box is what is stored. */}
        <div className="flex items-center gap-0.5">
          <ToolButton label="Bold (⌘B)" onClick={() => applyTool("bold")}>
            <Bold className="h-3 w-3" />
          </ToolButton>
          <ToolButton label="Italic (⌘I)" onClick={() => applyTool("italic")}>
            <Italic className="h-3 w-3" />
          </ToolButton>
          <ToolButton label="Bullet list" onClick={() => applyTool("list")}>
            <List className="h-3 w-3" />
          </ToolButton>
          {/* Typing "@" is still the primary way in; the button types it. */}
          <ToolButton label="Mention someone" onClick={startMention}>
            <AtSign className="h-3 w-3" />
          </ToolButton>
        </div>

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
            onClick={() => void submit()}
            disabled={body.trim() === "" || submitting}
          >
            <Send className="h-3 w-3" />
            {submitLabel}
          </Button>
        </span>
      </div>
    </div>
  );
}

/** One toolbar button — icon only, with the name in its tooltip and label. */
function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      // mousedown, not click: the textarea keeps its focus and its selection,
      // which is the thing the tool is about to wrap.
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      aria-label={label}
      title={label}
      className="h-6 w-6 p-0 text-ink-3"
    >
      {children}
    </Button>
  );
}
