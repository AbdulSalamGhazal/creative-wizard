"use client";

import { useEffect, useState } from "react";
import { avatarColor, initialsOf } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/**
 * THE avatar (2026-10-20) — one component for every person picture in the
 * app: comment rows and replies, the bell, /notifications, the mention picker,
 * the account menu and the Team page. Never fork a second one.
 *
 * A profile PHOTO when the person has one; otherwise — and whenever the photo
 * fails to load (a deleted blob, a blocked host) — their coloured initials
 * from `lib/avatar.ts`, so a broken image never shows. A plain <img>, not
 * next/image: every photo is already a ~256 px square WebP of a few KB (the
 * browser downscaled it before upload), and at 20–48 px the optimizer would
 * add a round trip per size for nothing.
 *
 * Decorative by default (`aria-hidden`): it always sits beside the name it
 * pictures. Where it stands alone, the CONTROL around it carries the label.
 */

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE: Record<AvatarSize, string> = {
  /** 20 px — the mention picker, inline. */
  xs: "h-5 w-5 text-[8px]",
  /** 24 px — a reply. */
  sm: "h-6 w-6 text-[9px]",
  /** 28 px — a comment, a bell item, a /notifications row. */
  md: "h-7 w-7 text-[10px]",
  /** 32 px — the top bar's account button. */
  lg: "h-8 w-8 text-[11px]",
  /** 48 px — the Team page and the account menu's photo row. */
  xl: "h-12 w-12 text-sm",
};

export function UserAvatar({
  name,
  src,
  size = "md",
  className,
}: {
  /** Null when the account is gone ("Former member") — renders "?". */
  name: string | null | undefined;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  // A new photo gets a fresh chance to load.
  useEffect(() => setFailed(false), [src]);
  const showPhoto = Boolean(src) && !failed;

  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold leading-none text-[var(--primary-foreground)]",
        SIZE[size],
        className,
      )}
      style={showPhoto ? undefined : { background: name ? avatarColor(name) : "var(--surface-3)" }}
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- see the note above
        <img
          src={src ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
