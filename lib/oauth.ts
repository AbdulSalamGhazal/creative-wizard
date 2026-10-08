import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { oauthClients, oauthCodes, oauthTokens } from "@/db/schema";
import { loadUserById, type SessionUser } from "@/lib/auth";

/**
 * OAuth 2.1 authorization server for the MCP endpoint.
 *
 * WHAT THIS BUYS: connecting from claude.ai becomes a browser sign-in instead
 * of a pasted `cwz_` key. Claude discovers the server from a 401 on
 * `/api/mcp/mcp`, registers itself (RFC 7591), sends the user to our authorize
 * page, and exchanges the code for tokens. The app is BOTH the authorization
 * server and the protected resource.
 *
 * DUAL AUTH, deliberately: personal access tokens (`lib/api-token.ts`) keep
 * working exactly as before. Whether to retire them is a later decision — and
 * they are the only path for clients whose redirect URI is `http://localhost`
 * (mcp-remote, Claude Desktop), since registration here is https-only.
 *
 * NO NEW DEPENDENCY and NO JWT: tokens are opaque random strings, stored as
 * SHA-256 and resolved by a single indexed lookup. An opaque token can be
 * revoked the instant the user asks; a self-contained JWT cannot.
 *
 * THE SECURITY RULES, all of them enforced below and pinned by tests:
 *   1. redirect_uri matching is EXACT and https-only. A mismatch renders an
 *      error page and NEVER redirects (that is the open-redirect hole).
 *   2. PKCE S256 is required — no `plain`, no omission.
 *   3. An authorization code is single-use, 10 minutes, and bound to its
 *      client + redirect_uri + challenge + user. Consumption is ONE atomic
 *      `UPDATE … WHERE consumed_at IS NULL RETURNING`, so a replay loses the
 *      race rather than minting a second token pair.
 *   4. A replayed code revokes the token family already issued from it.
 *   5. Refresh tokens rotate on every use, and reusing a rotated one revokes
 *      the whole family (OAuth 2.1 reuse detection).
 *   6. Nothing secret is stored or logged in the clear.
 */

// ---- Shapes and lifetimes ---------------------------------------------------

/** Access tokens are self-identifying, like `cwz_` keys, and distinct from them. */
export const ACCESS_TOKEN_PREFIX = "cwz_at_";
export const REFRESH_TOKEN_PREFIX = "cwz_rt_";

export const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes (RFC 6749 §4.1.2 "short")
export const ACCESS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/** The MCP endpoint this authorization server protects. */
export const MCP_RESOURCE_PATH = "/api/mcp/mcp";
/** RFC 9728 — where a 401 points the client to start discovery. */
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
export const AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server";

export const AUTHORIZE_PATH = "/api/oauth/authorize";
export const TOKEN_PATH = "/api/oauth/token";
export const REGISTER_PATH = "/api/oauth/register";
/** The consent screen — the app's own UI, behind the normal session gate. */
export const CONSENT_PATH = "/oauth/consent";

/** The only scope v1 has. The MCP server is read-only; there is nothing else. */
export const DEFAULT_SCOPE = "mcp:read";

// ---- Crypto helpers ---------------------------------------------------------

/** SHA-256 hex — what we store for every secret in this module. */
export function hashSecret(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Constant-time hex compare, used as defense in depth on top of the lookup. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** 32 random bytes as base64url — the body of every secret this module mints. */
function randomSecret(prefix = ""): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

/**
 * The PKCE S256 transform (RFC 7636 §4.2): BASE64URL(SHA256(ASCII(verifier))).
 * The verifier is hashed as ASCII bytes and the digest is base64url WITHOUT
 * padding — a `=` or a `+` here is the classic interop bug.
 */
export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

// ---- The canonical origin ---------------------------------------------------

/**
 * The issuer. EVERY document and endpoint URL must agree on it, because a
 * client compares the issuer in the metadata against where it fetched it from
 * and aborts on a mismatch. `APP_ORIGIN` wins when set (the deployed canonical
 * host); otherwise the request's own host, which is what makes previews and
 * localhost work without configuration.
 */
export function canonicalOrigin(req: Request): string {
  const configured = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host") ||
    "localhost:3000";
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

// ---- Discovery documents ----------------------------------------------------

/** RFC 9728 — the protected-resource metadata a 401 points at. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_RESOURCE_PATH}`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: [DEFAULT_SCOPE],
    resource_name: "Creative Wizard MCP",
    resource_documentation: `${origin}/account/api`,
  };
}

/** RFC 8414 — what the authorization server supports. S256 only, by decision. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    registration_endpoint: `${origin}${REGISTER_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: [DEFAULT_SCOPE],
    service_documentation: `${origin}/account/api`,
  };
}

/** The `WWW-Authenticate` value that starts the whole flow from a 401. */
export function wwwAuthenticateHeader(origin: string, error?: string): string {
  const parts = [
    `Bearer realm="Wizard MCP"`,
    `resource_metadata="${origin}${PROTECTED_RESOURCE_PATH}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  return parts.join(", ");
}

// ---- Clients ----------------------------------------------------------------

export type TokenEndpointAuthMethod = "none" | "client_secret_post";

export interface OauthClientRow {
  id: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
  clientSecretHash: string | null;
}

/**
 * Is this an acceptable redirect URI to REGISTER? https, absolute, no fragment,
 * and no wildcard characters. Loopback http is refused on purpose — see the
 * module note; those clients use a personal token instead.
 */
export function isRegisterableRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return false;
  if (raw.includes("*")) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.hash !== "") return false;
  return true;
}

/**
 * EXACT match against the registered set — string equality, nothing else. No
 * normalization, no prefix match, no "same origin is close enough": every one
 * of those is an open redirect waiting for a bug report.
 */
export function isAllowedRedirectUri(client: OauthClientRow, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri);
}

export interface RegisterClientInput {
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
}

export interface RegisteredClient {
  clientId: string;
  /** Returned ONCE, only for `client_secret_post` clients. Never stored raw. */
  clientSecret?: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  createdAt: Date;
}

export async function registerClient(
  input: RegisterClientInput,
): Promise<RegisteredClient> {
  const secret =
    input.tokenEndpointAuthMethod === "client_secret_post" ? randomSecret("cwz_cs_") : null;
  const [row] = await db
    .insert(oauthClients)
    .values({
      clientName: input.clientName,
      redirectUris: input.redirectUris,
      tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
      clientSecretHash: secret ? hashSecret(secret) : null,
    })
    .returning({ id: oauthClients.id, createdAt: oauthClients.createdAt });
  return {
    clientId: row!.id,
    ...(secret ? { clientSecret: secret } : {}),
    clientName: input.clientName,
    redirectUris: input.redirectUris,
    tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
    createdAt: row!.createdAt,
  };
}

/** One client by id, or null. A malformed id is "not found", never a throw. */
export async function findClient(clientId: string): Promise<OauthClientRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return null;
  const [row] = await db
    .select({
      id: oauthClients.id,
      clientName: oauthClients.clientName,
      redirectUris: oauthClients.redirectUris,
      tokenEndpointAuthMethod: oauthClients.tokenEndpointAuthMethod,
      clientSecretHash: oauthClients.clientSecretHash,
    })
    .from(oauthClients)
    .where(eq(oauthClients.id, clientId))
    .limit(1);
  return row ?? null;
}

// ---- Authorization codes ----------------------------------------------------

export interface CreateCodeInput {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope?: string | null;
}

/** Mint a code. The RAW value is returned (it travels in the redirect) and hashed at rest. */
export async function createAuthorizationCode(input: CreateCodeInput): Promise<string> {
  const raw = randomSecret("cwz_ac_");
  await db.insert(oauthCodes).values({
    codeHash: hashSecret(raw),
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: input.scope ?? DEFAULT_SCOPE,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return raw;
}

// ---- Tokens -----------------------------------------------------------------

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds, for the `expires_in` field. */
  expiresIn: number;
  scope: string;
  familyId: string;
}

/**
 * Issue an access + refresh pair in one family. `familyId` is the authorization
 * code's row id for a fresh grant, and carries over through every rotation —
 * that lineage is what reuse detection and the user's Revoke button act on.
 */
async function issueTokenPair(args: {
  familyId: string;
  clientId: string;
  userId: string;
  scope: string;
}): Promise<TokenPair> {
  const accessToken = randomSecret(ACCESS_TOKEN_PREFIX);
  const refreshToken = randomSecret(REFRESH_TOKEN_PREFIX);
  const now = Date.now();
  await db.insert(oauthTokens).values([
    {
      kind: "access",
      tokenHash: hashSecret(accessToken),
      familyId: args.familyId,
      clientId: args.clientId,
      userId: args.userId,
      scope: args.scope,
      expiresAt: new Date(now + ACCESS_TTL_MS),
    },
    {
      kind: "refresh",
      tokenHash: hashSecret(refreshToken),
      familyId: args.familyId,
      clientId: args.clientId,
      userId: args.userId,
      scope: args.scope,
      expiresAt: new Date(now + REFRESH_TTL_MS),
    },
  ]);
  return {
    accessToken,
    refreshToken,
    expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
    scope: args.scope,
    familyId: args.familyId,
  };
}

/**
 * Revoke every un-revoked token in a family. Used by reuse detection, by code
 * replay, and by the user's Revoke button — one lineage, one kill switch.
 */
export async function revokeTokenFamily(familyId: string): Promise<number> {
  const rows = await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.familyId, familyId), isNull(oauthTokens.revokedAt)))
    .returning({ id: oauthTokens.id });
  return rows.length;
}

// ---- Grant: authorization_code ---------------------------------------------

/** OAuth error codes this server emits (RFC 6749 §5.2 + RFC 7636). */
export type OauthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "access_denied"
  | "server_error";

export interface GrantFailure {
  ok: false;
  error: OauthErrorCode;
  description: string;
}
export type GrantResult = ({ ok: true } & TokenPair) | GrantFailure;

function fail(error: OauthErrorCode, description: string): GrantFailure {
  return { ok: false, error, description };
}

/**
 * Authenticate the client at the token endpoint. A `none` client proves nothing
 * beyond its id (PKCE is what binds the exchange); a `client_secret_post`
 * client must present the secret, compared against its stored hash.
 */
function clientAuthOk(client: OauthClientRow, presentedSecret: string | null): boolean {
  if (client.tokenEndpointAuthMethod === "client_secret_post") {
    if (!presentedSecret || !client.clientSecretHash) return false;
    return timingSafeEqualHex(client.clientSecretHash, hashSecret(presentedSecret));
  }
  // A public client that sends a secret anyway is not a reason to fail; the
  // secret simply means nothing. PKCE is the binding.
  return true;
}

export interface CodeGrantInput {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  clientSecret?: string | null;
}

export async function exchangeAuthorizationCode(
  input: CodeGrantInput,
): Promise<GrantResult> {
  const client = await findClient(input.clientId);
  if (!client) return fail("invalid_client", "Unknown client_id.");
  if (!clientAuthOk(client, input.clientSecret ?? null)) {
    return fail("invalid_client", "Client authentication failed.");
  }
  if (!input.code || !input.codeVerifier) {
    return fail("invalid_request", "code and code_verifier are required.");
  }

  const codeHash = hashSecret(input.code);
  const now = new Date();

  // THE ATOMIC CONSUME. One statement claims the code; two concurrent
  // exchanges cannot both win, because only one UPDATE sees `consumed_at IS
  // NULL`. A read-then-write here would be the replay bug this guards against.
  const [claimed] = await db
    .update(oauthCodes)
    .set({ consumedAt: now })
    .where(
      and(
        eq(oauthCodes.codeHash, codeHash),
        isNull(oauthCodes.consumedAt),
        // Drizzle's own comparator, not a raw template: a JS Date can't be bound
        // inside `sql` by the postgres driver.
        gt(oauthCodes.expiresAt, now),
      ),
    )
    .returning({
      id: oauthCodes.id,
      clientId: oauthCodes.clientId,
      userId: oauthCodes.userId,
      redirectUri: oauthCodes.redirectUri,
      codeChallenge: oauthCodes.codeChallenge,
      scope: oauthCodes.scope,
    });

  if (!claimed) {
    // Why did it fail? An ALREADY-CONSUMED code is a replay: either the client
    // is buggy or someone stole the code, and in both cases the safe move is to
    // kill what that code produced (RFC 6749 §10.5 / OAuth 2.1 §4.1.3).
    const [existing] = await db
      .select({
        id: oauthCodes.id,
        consumedAt: oauthCodes.consumedAt,
        expiresAt: oauthCodes.expiresAt,
      })
      .from(oauthCodes)
      .where(eq(oauthCodes.codeHash, codeHash))
      .limit(1);
    if (existing?.consumedAt) {
      await revokeTokenFamily(existing.id);
      return fail("invalid_grant", "Authorization code already used.");
    }
    if (existing) return fail("invalid_grant", "Authorization code expired.");
    return fail("invalid_grant", "Authorization code is invalid.");
  }

  // Bindings. A code issued to client A is useless to client B, and it only
  // works at the exact redirect_uri it was minted for.
  if (claimed.clientId !== client.id) {
    await revokeTokenFamily(claimed.id);
    return fail("invalid_grant", "Authorization code was issued to another client.");
  }
  if (claimed.redirectUri !== input.redirectUri) {
    return fail("invalid_grant", "redirect_uri does not match the authorization request.");
  }
  // PKCE: the verifier must hash to the challenge recorded at authorize time.
  if (s256Challenge(input.codeVerifier) !== claimed.codeChallenge) {
    return fail("invalid_grant", "PKCE verification failed.");
  }

  const pair = await issueTokenPair({
    familyId: claimed.id,
    clientId: client.id,
    userId: claimed.userId,
    scope: claimed.scope ?? DEFAULT_SCOPE,
  });
  return { ok: true, ...pair };
}

// ---- Grant: refresh_token ---------------------------------------------------

export interface RefreshGrantInput {
  refreshToken: string;
  clientId: string;
  clientSecret?: string | null;
}

/**
 * Rotate a refresh token. The presented token is marked rotated and a NEW pair
 * is issued in the same family. Presenting a token that was already rotated (or
 * revoked) means a stale copy is in circulation — the whole family dies, which
 * logs the real client out too. That is the intended trade: a user re-connecting
 * is cheap, a silently cloned grant is not.
 */
export async function refreshTokenGrant(input: RefreshGrantInput): Promise<GrantResult> {
  const client = await findClient(input.clientId);
  if (!client) return fail("invalid_client", "Unknown client_id.");
  if (!clientAuthOk(client, input.clientSecret ?? null)) {
    return fail("invalid_client", "Client authentication failed.");
  }
  if (!input.refreshToken) return fail("invalid_request", "refresh_token is required.");

  const hash = hashSecret(input.refreshToken);
  const now = new Date();

  const [rotated] = await db
    .update(oauthTokens)
    .set({ rotatedAt: now })
    .where(
      and(
        eq(oauthTokens.tokenHash, hash),
        eq(oauthTokens.kind, "refresh"),
        isNull(oauthTokens.rotatedAt),
        isNull(oauthTokens.revokedAt),
        gt(oauthTokens.expiresAt, now),
      ),
    )
    .returning({
      id: oauthTokens.id,
      familyId: oauthTokens.familyId,
      clientId: oauthTokens.clientId,
      userId: oauthTokens.userId,
      scope: oauthTokens.scope,
    });

  if (!rotated) {
    const [existing] = await db
      .select({
        familyId: oauthTokens.familyId,
        rotatedAt: oauthTokens.rotatedAt,
        revokedAt: oauthTokens.revokedAt,
      })
      .from(oauthTokens)
      .where(and(eq(oauthTokens.tokenHash, hash), eq(oauthTokens.kind, "refresh")))
      .limit(1);
    if (existing?.rotatedAt && !existing.revokedAt) {
      // REUSE DETECTED.
      await revokeTokenFamily(existing.familyId);
      return fail("invalid_grant", "Refresh token was already used; the grant has been revoked.");
    }
    if (existing) return fail("invalid_grant", "Refresh token is expired or revoked.");
    return fail("invalid_grant", "Refresh token is invalid.");
  }

  if (rotated.clientId !== client.id) {
    await revokeTokenFamily(rotated.familyId);
    return fail("invalid_grant", "Refresh token belongs to another client.");
  }

  // The access token issued alongside the rotated refresh token is dead weight
  // from here on; revoking it keeps exactly one live access token per family.
  await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(oauthTokens.familyId, rotated.familyId),
        eq(oauthTokens.kind, "access"),
        isNull(oauthTokens.revokedAt),
      ),
    );

  const pair = await issueTokenPair({
    familyId: rotated.familyId,
    clientId: client.id,
    userId: rotated.userId,
    scope: rotated.scope ?? DEFAULT_SCOPE,
  });
  return { ok: true, ...pair };
}

// ---- Resource-server verification ------------------------------------------

/** Stamp `last_used_at` at most once a minute, like personal tokens do. */
const LAST_USED_THROTTLE_MS = 60_000;

export interface OauthActor {
  user: SessionUser;
  /** The access token row id — the per-token rate-limit key. */
  tokenId: string;
  familyId: string;
}

/**
 * Resolve an access token to its user. Returns null for anything unusable —
 * unknown, expired, revoked, or belonging to a deleted user — and the MCP route
 * turns that into a 401 with `WWW-Authenticate`, which is the signal that makes
 * Claude refresh silently instead of asking the user to reconnect.
 */
export async function verifyAccessToken(
  bearer: string | null | undefined,
): Promise<OauthActor | null> {
  if (!bearer) return null;
  const raw = bearer.replace(/^Bearer\s+/i, "").trim();
  if (!raw.startsWith(ACCESS_TOKEN_PREFIX) || raw.length < ACCESS_TOKEN_PREFIX.length + 20) {
    return null;
  }
  const hash = hashSecret(raw);
  const [row] = await db
    .select({
      id: oauthTokens.id,
      tokenHash: oauthTokens.tokenHash,
      familyId: oauthTokens.familyId,
      userId: oauthTokens.userId,
      expiresAt: oauthTokens.expiresAt,
      revokedAt: oauthTokens.revokedAt,
      lastUsedAt: oauthTokens.lastUsedAt,
    })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.tokenHash, hash), eq(oauthTokens.kind, "access")))
    .limit(1);

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  if (!timingSafeEqualHex(row.tokenHash, hash)) return null;

  const user = await loadUserById(row.userId);
  if (!user) return null; // user deleted out from under the grant

  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    await db
      .update(oauthTokens)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(oauthTokens.id, row.id));
  }
  return { user, tokenId: row.id, familyId: row.familyId };
}

// ---- The user's view: grants ------------------------------------------------

export interface OauthGrantRow {
  familyId: string;
  clientId: string;
  clientName: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/**
 * One row per LIVE grant (token family) for this user, newest first. A family
 * is live while any of its tokens is un-revoked; `last_used_at` is the most
 * recent across the family, so a rotation doesn't look like a new connection.
 */
export async function listOauthGrants(userId: string): Promise<OauthGrantRow[]> {
  const rows = await db
    .select({
      familyId: oauthTokens.familyId,
      clientId: oauthClients.id,
      clientName: oauthClients.clientName,
      createdAt: sql<Date>`min(${oauthTokens.createdAt})`,
      lastUsedAt: sql<Date | null>`max(${oauthTokens.lastUsedAt})`,
    })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthTokens.clientId))
    .where(and(eq(oauthTokens.userId, userId), isNull(oauthTokens.revokedAt)))
    .groupBy(oauthTokens.familyId, oauthClients.id, oauthClients.clientName)
    .orderBy(desc(sql`min(${oauthTokens.createdAt})`));
  return rows.map((r) => ({
    ...r,
    createdAt: new Date(r.createdAt),
    lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt) : null,
  }));
}

/**
 * Revoke one grant — scoped to `userId`, so nobody can revoke someone else's
 * connection. Returns the client name for the audit label, or null when the
 * family isn't the caller's (or is already gone).
 */
export async function revokeOauthGrant(
  familyId: string,
  userId: string,
): Promise<{ clientName: string } | null> {
  const [mine] = await db
    .select({ clientName: oauthClients.clientName })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthTokens.clientId))
    .where(
      and(
        eq(oauthTokens.familyId, familyId),
        eq(oauthTokens.userId, userId),
        isNull(oauthTokens.revokedAt),
      ),
    )
    .limit(1);
  if (!mine) return null;
  await revokeTokenFamily(familyId);
  return mine;
}
