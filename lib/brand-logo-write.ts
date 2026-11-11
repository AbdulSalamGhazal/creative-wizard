import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/db/schema";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { discardImage, isOwnImageUrl } from "@/lib/avatar-storage";

/**
 * The ONE writer of `accounts.logo_url` (2026-11), shared by `uploadBrandLogo`
 * (set) and `removeBrandLogo` (null) — the `writeAvatar` pattern: swap the
 * column, discard the replaced file (best effort), audit under THAT brand.
 * The caller has already checked `config.brands` and membership.
 */
export async function writeBrandLogo(input: {
  accountId: string;
  url: string | null;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // The column only ever holds a logo WE stored — never an arbitrary URL.
  if (input.url !== null && !isOwnImageUrl(input.url, "brand-logos")) {
    return { ok: false, error: "That isn't an uploaded logo." };
  }
  const [before] = await db
    .select({ name: accounts.name, logoUrl: accounts.logoUrl })
    .from(accounts)
    .where(eq(accounts.id, input.accountId))
    .limit(1);
  if (!before) return { ok: false, error: "That brand no longer exists." };

  await db
    .update(accounts)
    .set({ logoUrl: input.url })
    .where(eq(accounts.id, input.accountId));

  if (before.logoUrl && before.logoUrl !== input.url) {
    await discardImage(before.logoUrl, "brand-logos");
  }

  await logAudit({
    action: AUDIT_ACTIONS.ACCOUNT_STYLE_UPDATE,
    entityType: "account",
    entityId: input.accountId,
    entityLabel: before.name,
    actorUserId: input.actorUserId,
    accountId: input.accountId,
    meta: { logo: input.url === null ? "removed" : "added" },
  });
  return { ok: true };
}
