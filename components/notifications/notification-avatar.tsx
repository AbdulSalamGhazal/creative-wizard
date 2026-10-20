"use client";

import { UserAvatar, type AvatarSize } from "@/components/user/user-avatar";
import { categoryIcon } from "@/components/filters/filter-icons";

/**
 * Who it was, with WHAT KIND of thing it is tucked against the picture — the
 * category glyph from the shared `CATEGORY_ICONS` map. ONE piece for the bell
 * and /notifications (2026-10-20), built on the one `UserAvatar`. A system
 * notification has no actor: the glyph stands alone in a neutral circle.
 */
export function NotificationAvatar({
  actor,
  avatarUrl,
  category,
  size = "md",
}: {
  actor: string | null;
  avatarUrl: string | null;
  category: string;
  size?: AvatarSize;
}) {
  const Icon = categoryIcon(category);
  if (!actor) {
    return (
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3"
      >
        <Icon className="h-3.5 w-3.5 text-ink-2" />
      </span>
    );
  }
  return (
    <span className="relative shrink-0" aria-hidden>
      <UserAvatar name={actor} src={avatarUrl} size={size} />
      <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-line bg-surface">
        <Icon className="h-2.5 w-2.5 text-ink-3" />
      </span>
    </span>
  );
}
