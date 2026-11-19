import { z } from "zod";

/**
 * OAuth inputs — the consent decision and grant revocation
 * (`app/actions/oauth.ts`) and RFC 7591 dynamic client registration
 * (`app/api/oauth/register/route.ts`). Moved here verbatim 2026-11-19 so every
 * input schema lives in `validators/`; the security rules on `redirect_uris`
 * are still applied by the route after this shape check.
 */

export const oauthDecideSchema = z.object({
  /** The authorize request's query string, exactly as the page received it. */
  query: z.string().min(1).max(4096),
  decision: z.enum(["allow", "deny"]),
});

export const oauthRevokeSchema = z.object({ familyId: z.string().uuid() });

export const oauthRegisterSchema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z.array(z.string()).min(1).max(10),
  token_endpoint_auth_method: z.enum(["none", "client_secret_post"]).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});
