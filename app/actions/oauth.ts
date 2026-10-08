"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { actionError } from "@/lib/action-error";
import { createAuthorizationCode, revokeOauthGrant } from "@/lib/oauth";
import {
  clientRedirect,
  readAuthorizeParams,
  resolveAuthorizeRequest,
} from "@/lib/oauth-authorize";

/**
 * The consent decision, and revoking a connection afterwards.
 *
 * ALLOW RE-VALIDATES EVERYTHING FROM THE QUERY STRING. The consent page already
 * validated to render, but this action is a separate request and must not trust
 * what the browser hands back — a tampered client_id or redirect_uri has to fail
 * here, not mint a code. That is also why the action takes the raw query rather
 * than pre-parsed fields: one parser, one validator, both surfaces.
 *
 * It returns the URL instead of redirecting: `redirect()` to an external origin
 * from a server action is at the mercy of the router, and this hop is the one
 * that carries the authorization code.
 */

const decideSchema = z.object({
  /** The authorize request's query string, exactly as the page received it. */
  query: z.string().min(1).max(4096),
  decision: z.enum(["allow", "deny"]),
});

const revokeSchema = z.object({ familyId: z.string().uuid() });

export interface ConsentResult {
  ok: boolean;
  /** Where the browser should go next (always the client's registered URI). */
  redirectTo?: string;
  error?: string;
}

export async function decideOauthConsent(input: unknown): Promise<ConsentResult> {
  try {
    const me = await requireAuth();
    const parsed = decideSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "This request is malformed." };

    const url = new URL(`https://placeholder.invalid/authorize?${parsed.data.query.replace(/^\?/, "")}`);
    const params = readAuthorizeParams(url);
    const check = await resolveAuthorizeRequest(params);
    if (check.kind !== "ok") {
      // Either phase-1 (nowhere safe to go) or an invalid request: the page
      // shows the message instead of bouncing anywhere.
      return {
        ok: false,
        error:
          check.kind === "page_error"
            ? check.detail
            : `${check.error}: ${check.description}`,
      };
    }

    if (parsed.data.decision === "deny") {
      return {
        ok: true,
        redirectTo: clientRedirect(
          params.redirectUri,
          { error: "access_denied", error_description: "The user declined the request." },
          params.state,
        ),
      };
    }

    const code = await createAuthorizationCode({
      clientId: check.client.id,
      userId: me.id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scope: check.scope,
    });

    await logAudit({
      action: AUDIT_ACTIONS.OAUTH_GRANT,
      entityType: "user",
      entityId: me.id,
      entityLabel: me.email,
      actorUserId: me.id,
      // The client and what was agreed — never the code, never a hash of it.
      meta: { clientId: check.client.id, clientName: check.client.clientName, scope: check.scope },
    });

    return {
      ok: true,
      redirectTo: clientRedirect(params.redirectUri, { code }, params.state),
    };
  } catch (err) {
    return { ok: false, error: actionError(err, "oauth") };
  }
}

export async function revokeOauthGrantAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const me = await requireAuth();
    const parsed = revokeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid connection id" };

    // Scoped to the caller — one user can never revoke another's connection.
    const revoked = await revokeOauthGrant(parsed.data.familyId, me.id);
    if (!revoked) return { ok: false, error: "Connection not found." };

    await logAudit({
      action: AUDIT_ACTIONS.OAUTH_REVOKE,
      entityType: "user",
      entityId: me.id,
      entityLabel: me.email,
      actorUserId: me.id,
      meta: { familyId: parsed.data.familyId, clientName: revoked.clientName },
    });

    try {
      revalidatePath("/account/api");
    } catch (err) {
      console.warn("revalidatePath after oauth revoke failed:", err);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "oauth") };
  }
}
