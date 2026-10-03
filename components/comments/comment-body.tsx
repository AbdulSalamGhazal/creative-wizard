"use client";

import { useMemo } from "react";
import { commentHtml } from "@/lib/comment-markdown";

/**
 * A comment's body, rendered.
 *
 * This is the ONE component that sets HTML from user input, and it is safe
 * because `commentHtml` escapes the whole body BEFORE it transforms anything
 * — the only tags in its output are the ones that module writes (strong, em,
 * ul/li, http(s)-only anchors, and the mention span). Never pass anything else
 * to `dangerouslySetInnerHTML`, and never pre-transform the body before it
 * gets here.
 */
export function CommentBody({
  body,
  mentionNames,
  className,
}: {
  body: string;
  /** Names actually RECORDED as mentioned — a typed "@x" stays plain text. */
  mentionNames: readonly string[];
  className?: string;
}) {
  const html = useMemo(
    () => commentHtml(body, mentionNames),
    [body, mentionNames],
  );
  return (
    <div
      className={className ?? "comment-body mt-1 text-sm text-ink-2"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
