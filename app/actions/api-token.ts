"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { createApiToken, revokeApiToken } from "@/lib/api-token";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

/**
 * Self-serve personal API tokens for the MCP server. EVERY user manages their
 * OWN tokens (no permission gate beyond being signed in) — a token only ever
 * grants what its owner already has. The raw secret is returned ONCE from
 * `create` and never stored or logged.
 */

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the token a name.").max(64, "Too long."),
});
const revokeSchema = z.object({ tokenId: z.string().uuid() });

export interface CreateTokenResult {
  ok: boolean;
  error?: string;
  /** The full secret — shown ONCE. Absent on failure. */
  token?: string;
  prefix?: string;
}

export async function createApiTokenAction(
  input: unknown,
): Promise<CreateTokenResult> {
  try {
    const me = await requireAuth();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const { raw, row } = await createApiToken(me.id, parsed.data.name);

    await logAudit({
      action: AUDIT_ACTIONS.TOKEN_CREATE,
      entityType: "user",
      entityId: me.id,
      entityLabel: me.email,
      actorUserId: me.id,
      // NEVER log the secret or its hash — just the label + display prefix.
      meta: { tokenId: row.id, name: row.name, prefix: row.prefix },
    });

    try {
      revalidatePath("/account/api");
    } catch (err) {
      console.warn("revalidatePath after token create failed:", err);
    }
    return { ok: true, token: raw, prefix: row.prefix };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function revokeApiTokenAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const me = await requireAuth();
    const parsed = revokeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid token id" };

    const revoked = await revokeApiToken(parsed.data.tokenId, me.id);
    if (!revoked) return { ok: false, error: "Token not found." };

    await logAudit({
      action: AUDIT_ACTIONS.TOKEN_REVOKE,
      entityType: "user",
      entityId: me.id,
      entityLabel: me.email,
      actorUserId: me.id,
      meta: { tokenId: parsed.data.tokenId, name: revoked.name },
    });

    try {
      revalidatePath("/account/api");
    } catch (err) {
      console.warn("revalidatePath after token revoke failed:", err);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
