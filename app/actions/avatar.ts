"use server";

import { requireAuth, requirePermission } from "@/lib/auth";
import { actionError } from "@/lib/action-error";
import { writeAvatar } from "@/lib/avatar-write";
import { avatarTargetSchema } from "@/validators/avatar";

/**
 * Remove a profile photo — back to coloured initials (2026-10-20). Setting
 * one is the upload route (`/api/uploads/avatar`), because it carries a file.
 */

export interface AvatarActionResult {
  ok: boolean;
  error?: string;
}

/** Your own photo. No input: the session user is the subject. */
export async function removeMyAvatar(): Promise<AvatarActionResult> {
  try {
    const me = await requireAuth();
    return await writeAvatar({ targetUserId: me.id, url: null, actorUserId: me.id });
  } catch (err) {
    return { ok: false, error: actionError(err, "avatar") };
  }
}

/** Someone else's — the Team page, behind `users.manage`. */
export async function removeUserAvatar(input: unknown): Promise<AvatarActionResult> {
  try {
    const me = await requirePermission("users.manage");
    const parsed = avatarTargetSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid person." };
    return await writeAvatar({
      targetUserId: parsed.data.userId,
      url: null,
      actorUserId: me.id,
    });
  } catch (err) {
    return { ok: false, error: actionError(err, "avatar") };
  }
}
