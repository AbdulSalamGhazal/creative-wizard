import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { discardAvatar, isOwnAvatarUrl } from "@/lib/avatar-storage";

/**
 * The ONE writer of `users.avatar_url` (2026-10-20), shared by the upload
 * route (set) and the remove actions (null). It swaps the column, discards the
 * previous file (best effort — a photo the person replaced or removed should
 * not linger on a public host), and audits the change.
 *
 * AUDITED, both ways: a profile photo is identity every colleague sees (like a
 * name), so a change to it is on the record — `meta.self` tells the person's
 * own change from an admin's (the password precedent: `auth.password_change`
 * vs `user.password_reset`, folded here into one action with a flag).
 */
export async function writeAvatar(input: {
  targetUserId: string;
  url: string | null;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // The column only ever holds a photo WE stored — never an arbitrary URL.
  if (input.url !== null && !isOwnAvatarUrl(input.url)) {
    return { ok: false, error: "That isn't an uploaded photo." };
  }
  const [before] = await db
    .select({ email: users.email, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, input.targetUserId))
    .limit(1);
  if (!before) return { ok: false, error: "That person no longer exists." };

  await db
    .update(users)
    .set({ avatarUrl: input.url })
    .where(eq(users.id, input.targetUserId));

  if (before.avatarUrl && before.avatarUrl !== input.url) await discardAvatar(before.avatarUrl);

  await logAudit({
    action: AUDIT_ACTIONS.USER_AVATAR_UPDATE,
    entityType: "user",
    entityId: input.targetUserId,
    entityLabel: before.email,
    actorUserId: input.actorUserId,
    meta: {
      self: input.targetUserId === input.actorUserId,
      removed: input.url === null,
    },
  });
  return { ok: true };
}
