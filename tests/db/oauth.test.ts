import { beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { oauthCodes, oauthTokens, userAccounts, users } from "@/db/schema";
import {
  ACCESS_TOKEN_PREFIX,
  REFRESH_TOKEN_PREFIX,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  hashSecret,
  listOauthGrants,
  refreshTokenGrant,
  registerClient,
  revokeOauthGrant,
  s256Challenge,
  verifyAccessToken,
} from "@/lib/oauth";
import { runWithMcpActor } from "@/lib/mcp/runtime";
import { registerMcpTools } from "@/lib/mcp/tools";
import { resetAndSeed } from "./fixtures";

/**
 * THE SECURITY BATTERY. Every case here is a way the flow goes wrong in the
 * wild, and most of them cannot be unit-tested: single-use consumption is a
 * RACE, and rotation and family revocation are states in a table.
 *
 * This suite deliberately does NOT mock `@/lib/tenant` — the last test drives
 * the real cookieless override, like tests/db/mcp.test.ts.
 */

const USER_A = "dddddddd-0000-0000-0000-00000000000a"; // member of ACCOUNT_A only
const USER_B = "dddddddd-0000-0000-0000-00000000000b"; // member of ACCOUNT_B only
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const OTHER_CALLBACK = "https://claude.ai/api/mcp/other_callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = s256Challenge(VERIFIER);

beforeAll(async () => {
  await resetAndSeed();
  await db.insert(users).values([
    { id: USER_A, email: "a@oauth.test", name: "User A", role: "editor", allAccounts: false },
    { id: USER_B, email: "b@oauth.test", name: "User B", role: "editor", allAccounts: false },
  ]);
  await db.insert(userAccounts).values([
    { userId: USER_A, accountId: ACCOUNT_A },
    { userId: USER_B, accountId: ACCOUNT_B },
  ]);
});

/** A fresh registered client — each test gets its own so ids never collide. */
async function client(
  method: "none" | "client_secret_post" = "none",
  uris: string[] = [CALLBACK],
) {
  return registerClient({
    clientName: "Claude",
    redirectUris: uris,
    tokenEndpointAuthMethod: method,
  });
}

/** Consent → code, as the server action does it. */
function code(clientId: string, userId = USER_A, redirectUri = CALLBACK) {
  return createAuthorizationCode({
    clientId,
    userId,
    redirectUri,
    codeChallenge: CHALLENGE,
  });
}

describe("the happy path", () => {
  it("exchanges a code for a usable access token that resolves to its user", async () => {
    const c = await client();
    const raw = await code(c.clientId);
    const res = await exchangeAuthorizationCode({
      code: raw,
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.accessToken.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(res.refreshToken.startsWith(REFRESH_TOKEN_PREFIX)).toBe(true);
    expect(res.expiresIn).toBe(86400);

    const actor = await verifyAccessToken(`Bearer ${res.accessToken}`);
    expect(actor?.user.id).toBe(USER_A);
    expect(actor?.familyId).toBe(res.familyId);
  });

  it("a client_secret_post client must present its secret", async () => {
    const c = await client("client_secret_post");
    expect(c.clientSecret).toBeTruthy();

    const withoutSecret = await exchangeAuthorizationCode({
      code: await code(c.clientId),
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    expect(withoutSecret.ok).toBe(false);
    if (!withoutSecret.ok) expect(withoutSecret.error).toBe("invalid_client");

    const wrongSecret = await exchangeAuthorizationCode({
      code: await code(c.clientId),
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
      clientSecret: "cwz_cs_not-it",
    });
    expect(wrongSecret.ok).toBe(false);

    const good = await exchangeAuthorizationCode({
      code: await code(c.clientId),
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
      clientSecret: c.clientSecret,
    });
    expect(good.ok).toBe(true);
  });
});

describe("the authorization code's bindings", () => {
  it("a WRONG PKCE verifier is refused", async () => {
    const c = await client();
    const res = await exchangeAuthorizationCode({
      code: await code(c.clientId),
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: "a-different-verifier-entirely-0000000000000",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("invalid_grant");
      expect(res.description).toMatch(/PKCE/i);
    }
  });

  it("a code is bound to its redirect_uri — a registered SIBLING uri won't do", async () => {
    const c = await client("none", [CALLBACK, OTHER_CALLBACK]);
    const res = await exchangeAuthorizationCode({
      code: await code(c.clientId, USER_A, CALLBACK),
      clientId: c.clientId,
      redirectUri: OTHER_CALLBACK,
      codeVerifier: VERIFIER,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.description).toMatch(/redirect_uri/i);
  });

  it("a code issued to client A is useless to client B", async () => {
    const a = await client();
    const b = await client();
    const res = await exchangeAuthorizationCode({
      code: await code(a.clientId),
      clientId: b.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.description).toMatch(/another client/i);
  });

  it("an EXPIRED code is refused", async () => {
    const c = await client();
    const raw = await code(c.clientId);
    await db
      .update(oauthCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthCodes.codeHash, hashSecret(raw)));
    const res = await exchangeAuthorizationCode({
      code: raw,
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.description).toMatch(/expired/i);
  });

  it("an unknown code is refused without saying which part was wrong", async () => {
    const c = await client();
    const res = await exchangeAuthorizationCode({
      code: "cwz_ac_nope",
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid_grant");
  });
});

describe("code replay", () => {
  it("is refused AND revokes the tokens the first exchange issued", async () => {
    const c = await client();
    const raw = await code(c.clientId);

    const first = await exchangeAuthorizationCode({
      code: raw,
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // The access token works right up to the replay.
    expect(await verifyAccessToken(`Bearer ${first.accessToken}`)).not.toBeNull();

    const replay = await exchangeAuthorizationCode({
      code: raw,
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.description).toMatch(/already used/i);

    // THE POINT: a stolen code that loses the race still burns the grant.
    expect(await verifyAccessToken(`Bearer ${first.accessToken}`)).toBeNull();
    const rows = await db
      .select({ revokedAt: oauthTokens.revokedAt })
      .from(oauthTokens)
      .where(eq(oauthTokens.familyId, first.familyId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it("two SIMULTANEOUS exchanges: exactly one wins", async () => {
    const c = await client();
    const raw = await code(c.clientId);
    const args = {
      code: raw,
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    };
    // The atomic UPDATE is what makes this deterministic; a read-then-write
    // here would hand out two token pairs.
    const [one, two] = await Promise.all([
      exchangeAuthorizationCode(args),
      exchangeAuthorizationCode(args),
    ]);
    expect([one.ok, two.ok].filter(Boolean)).toHaveLength(1);
  });
});

describe("refresh tokens", () => {
  it("rotate on use: the new one works, the old one does not", async () => {
    const c = await client();
    const first = await exchangeAuthorizationCode({
      code: await code(c.clientId),
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await refreshTokenGrant({
      refreshToken: first.refreshToken,
      clientId: c.clientId,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.familyId).toBe(first.familyId);
    // The new access token works; the rotated-out one is dead.
    expect(await verifyAccessToken(`Bearer ${second.accessToken}`)).not.toBeNull();
    expect(await verifyAccessToken(`Bearer ${first.accessToken}`)).toBeNull();

    // And rotation can continue.
    const third = await refreshTokenGrant({
      refreshToken: second.refreshToken,
      clientId: c.clientId,
    });
    expect(third.ok).toBe(true);
  });

  it("REUSE of a rotated refresh token revokes the whole family", async () => {
    const c = await client();
    const first = await exchangeAuthorizationCode({
      code: await code(c.clientId),
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    if (!first.ok) throw new Error("setup failed");
    const second = await refreshTokenGrant({
      refreshToken: first.refreshToken,
      clientId: c.clientId,
    });
    if (!second.ok) throw new Error("setup failed");

    // Someone presents the OLD refresh token: either the client is broken or a
    // copy leaked, and we cannot tell which.
    const reuse = await refreshTokenGrant({
      refreshToken: first.refreshToken,
      clientId: c.clientId,
    });
    expect(reuse.ok).toBe(false);
    if (!reuse.ok) expect(reuse.description).toMatch(/already used/i);

    // The LIVE pair dies with it — that is the trade OAuth 2.1 asks for.
    expect(await verifyAccessToken(`Bearer ${second.accessToken}`)).toBeNull();
    const after = await refreshTokenGrant({
      refreshToken: second.refreshToken,
      clientId: c.clientId,
    });
    expect(after.ok).toBe(false);
  });

  it("belongs to its client: another client cannot refresh it", async () => {
    const a = await client();
    const b = await client();
    const first = await exchangeAuthorizationCode({
      code: await code(a.clientId),
      clientId: a.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    if (!first.ok) throw new Error("setup failed");
    const res = await refreshTokenGrant({
      refreshToken: first.refreshToken,
      clientId: b.clientId,
    });
    expect(res.ok).toBe(false);
  });
});

describe("nothing secret is stored", () => {
  it("codes and tokens exist in the DB only as SHA-256 hashes", async () => {
    const c = await client();
    const rawCode = await code(c.clientId);
    const codeRows = await db
      .select({ codeHash: oauthCodes.codeHash })
      .from(oauthCodes)
      .where(eq(oauthCodes.codeHash, hashSecret(rawCode)));
    expect(codeRows).toHaveLength(1);
    expect(codeRows[0]!.codeHash).toMatch(/^[0-9a-f]{64}$/);

    const pair = await exchangeAuthorizationCode({
      code: rawCode,
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    if (!pair.ok) throw new Error("setup failed");

    const rows = await db
      .select({ kind: oauthTokens.kind, tokenHash: oauthTokens.tokenHash })
      .from(oauthTokens)
      .where(eq(oauthTokens.familyId, pair.familyId));
    expect(rows.map((r) => r.kind).sort()).toEqual(["access", "refresh"]);
    for (const r of rows) expect(r.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    // The raw strings appear NOWHERE in either table.
    const haystack = JSON.stringify([codeRows, rows]);
    expect(haystack).not.toContain(rawCode);
    expect(haystack).not.toContain(pair.accessToken);
    expect(haystack).not.toContain(pair.refreshToken);
    // And the stored hash is exactly the SHA-256 of the raw value.
    expect(rows.some((r) => r.tokenHash === hashSecret(pair.accessToken))).toBe(true);
  });

  it("a client secret is stored hashed too", async () => {
    const c = await client("client_secret_post");
    const { oauthClients } = await import("@/db/schema");
    const [row] = await db
      .select({ hash: oauthClients.clientSecretHash })
      .from(oauthClients)
      .where(eq(oauthClients.id, c.clientId));
    expect(row!.hash).toBe(hashSecret(c.clientSecret!));
    expect(row!.hash).not.toBe(c.clientSecret);
  });
});

describe("the user's own grants", () => {
  it("lists live grants and revoking one kills the family", async () => {
    const c = await client();
    const pair = await exchangeAuthorizationCode({
      code: await code(c.clientId, USER_B),
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    if (!pair.ok) throw new Error("setup failed");

    const mine = await listOauthGrants(USER_B);
    expect(mine.map((g) => g.familyId)).toContain(pair.familyId);
    expect(mine.find((g) => g.familyId === pair.familyId)?.clientName).toBe("Claude");

    // Another user cannot revoke it.
    expect(await revokeOauthGrant(pair.familyId, USER_A)).toBeNull();
    expect(await verifyAccessToken(`Bearer ${pair.accessToken}`)).not.toBeNull();

    // The owner can, and then everything in the family is dead.
    expect(await revokeOauthGrant(pair.familyId, USER_B)).not.toBeNull();
    expect(await verifyAccessToken(`Bearer ${pair.accessToken}`)).toBeNull();
    expect(
      (await refreshTokenGrant({ refreshToken: pair.refreshToken, clientId: c.clientId })).ok,
    ).toBe(false);
    expect((await listOauthGrants(USER_B)).map((g) => g.familyId)).not.toContain(
      pair.familyId,
    );
  });

  it("an expired access token resolves to nobody (the 401 that triggers a refresh)", async () => {
    const c = await client();
    const pair = await exchangeAuthorizationCode({
      code: await code(c.clientId),
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    if (!pair.ok) throw new Error("setup failed");
    await db
      .update(oauthTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(
        and(
          eq(oauthTokens.familyId, pair.familyId),
          eq(oauthTokens.kind, "access"),
        ),
      );
    expect(await verifyAccessToken(`Bearer ${pair.accessToken}`)).toBeNull();
    // The refresh token still works — which is the whole point of the pair.
    expect(
      (await refreshTokenGrant({ refreshToken: pair.refreshToken, clientId: c.clientId })).ok,
    ).toBe(true);
  });

  it("a refresh token is not an access token (and vice versa)", async () => {
    const c = await client();
    const pair = await exchangeAuthorizationCode({
      code: await code(c.clientId),
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    if (!pair.ok) throw new Error("setup failed");
    expect(await verifyAccessToken(`Bearer ${pair.refreshToken}`)).toBeNull();
    expect(
      (await refreshTokenGrant({ refreshToken: pair.accessToken, clientId: c.clientId })).ok,
    ).toBe(false);
  });
});

describe("an access token sees exactly its owner's brands", () => {
  /** Capture the registered MCP tool callbacks without a server. */
  function loadTools() {
    const tools = new Map<string, (a: unknown, e: unknown) => Promise<{ content: { text: string }[] }>>();
    registerMcpTools({
      registerTool: (
        name: string,
        _cfg: unknown,
        cb: (a: unknown, e: unknown) => Promise<{ content: { text: string }[] }>,
      ) => {
        tools.set(name, cb);
      },
    } as never);
    return tools;
  }

  it("user A's token lists ACCOUNT_A only, and cannot reach ACCOUNT_B by name", async () => {
    const c = await client();
    const pair = await exchangeAuthorizationCode({
      code: await code(c.clientId, USER_A),
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    if (!pair.ok) throw new Error("setup failed");
    const actor = await verifyAccessToken(`Bearer ${pair.accessToken}`);
    expect(actor).not.toBeNull();
    if (!actor) return;

    const tools = loadTools();
    const brands = await runWithMcpActor(
      { user: actor.user, tokenId: actor.tokenId },
      () => tools.get("list_brands")!({}, {}),
    );
    const out = JSON.parse(brands.content[0]!.text) as { brands: { id: string }[] };
    expect(out.brands.map((b) => b.id)).toEqual([ACCOUNT_A]);

    // Asking for the other brand by name fails the SAME way a personal token
    // does — the identity, not the credential kind, is what scopes access.
    const denied = await runWithMcpActor(
      { user: actor.user, tokenId: actor.tokenId },
      () => tools.get("get_kpis")!({ brand: "Brand B" }, {}),
    );
    expect(JSON.stringify(denied)).toMatch(/brand|not found|unknown/i);
    expect(JSON.stringify(denied)).not.toContain(ACCOUNT_B);
  });
});

describe("the MCP route is the resource server", () => {
  /**
   * The 401 contract, exercised through the real route handler: its body is
   * JSON-RPC, and its `WWW-Authenticate` header carries `resource_metadata` —
   * the pointer that makes a client discover this authorization server, and the
   * signal that makes it refresh rather than ask the user to reconnect.
   */
  async function callMcp(bearer: string | null): Promise<Response> {
    const { POST } = await import("@/app/api/mcp/[transport]/route");
    const req = new Request("https://wizard.test/api/mcp/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "wizard.test",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    return POST(req);
  }

  it("401s a revoked grant, with the discovery pointer", async () => {
    const c = await client();
    const pair = await exchangeAuthorizationCode({
      code: await code(c.clientId),
      clientId: c.clientId,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
    });
    if (!pair.ok) throw new Error("setup failed");
    await revokeOauthGrant(pair.familyId, USER_A);

    const res = await callMcp(pair.accessToken);
    expect(res.status).toBe(401);
    const header = res.headers.get("www-authenticate") ?? "";
    expect(header).toContain("Bearer");
    expect(header).toContain(
      'resource_metadata="https://wizard.test/.well-known/oauth-protected-resource"',
    );
  });

  it("401s a missing or unknown bearer the same way", async () => {
    for (const bearer of [null, "cwz_at_nonsense-value-that-is-long-enough", "cwz_whatever"]) {
      const res = await callMcp(bearer);
      expect(res.status, String(bearer)).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
    }
  });
});

describe("the HTTP endpoints, end to end", () => {
  const origin = "https://wizard.test";

  it("registers a client over HTTP and refuses the redirect URIs it should", async () => {
    const { POST } = await import("@/app/api/oauth/register/route");
    const call = (body: unknown) =>
      POST(
        new Request(`${origin}/api/oauth/register`, {
          method: "POST",
          headers: { "content-type": "application/json", host: "wizard.test" },
          body: JSON.stringify(body),
        }),
      );

    const ok = await call({
      client_name: "Claude",
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: "none",
    });
    expect(ok.status).toBe(201);
    const issued = (await ok.json()) as Record<string, unknown>;
    expect(typeof issued.client_id).toBe("string");
    // A public client gets NO secret — PKCE is the binding.
    expect(issued.client_secret).toBeUndefined();
    expect(issued.grant_types).toEqual(["authorization_code", "refresh_token"]);

    for (const uri of ["http://claude.ai/cb", "https://*.claude.ai/cb", "not-a-url"]) {
      const bad = await call({ client_name: "X", redirect_uris: [uri] });
      expect(bad.status, uri).toBe(400);
      expect((await bad.json()).error).toBe("invalid_redirect_uri");
    }

    const noUris = await call({ client_name: "X" });
    expect(noUris.status).toBe(400);
    expect((await noUris.json()).error).toBe("invalid_client_metadata");
  });

  it("exchanges a code at the token endpoint with a FORM body (what clients send)", async () => {
    const { POST } = await import("@/app/api/oauth/token/route");
    const c = await client();
    const raw = await code(c.clientId);

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: raw,
      client_id: c.clientId,
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
    });
    const res = await POST(
      new Request(`${origin}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", host: "wizard.test" },
        body: form.toString(),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(86400);
    expect(String(body.access_token).startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(await verifyAccessToken(`Bearer ${body.access_token as string}`)).not.toBeNull();

    // The replay through HTTP returns the standard error envelope.
    const replay = await POST(
      new Request(`${origin}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", host: "wizard.test" },
        body: form.toString(),
      }),
    );
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("invalid_grant");
  });

  it("refuses a grant type it does not support", async () => {
    const { POST } = await import("@/app/api/oauth/token/route");
    const res = await POST(
      new Request(`${origin}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", host: "wizard.test" },
        body: "grant_type=client_credentials",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unsupported_grant_type");
  });

  it("serves both discovery documents with the request's own origin as the issuer", async () => {
    const headers = { host: "wizard.test" };
    const as = await (await import("@/app/.well-known/oauth-authorization-server/route")).GET(
      new Request(`${origin}/.well-known/oauth-authorization-server`, { headers }),
    );
    expect((await as.json()).issuer).toBe(origin);

    const pr = await (await import("@/app/.well-known/oauth-protected-resource/route")).GET(
      new Request(`${origin}/.well-known/oauth-protected-resource`, { headers }),
    );
    const prBody = await pr.json();
    expect(prBody.resource).toBe(`${origin}/api/mcp/mcp`);

    // The path-suffixed form clients also ask for answers identically.
    const suffixed = await (
      await import("@/app/.well-known/oauth-protected-resource/[...path]/route")
    ).GET(
      new Request(`${origin}/.well-known/oauth-protected-resource/api/mcp/mcp`, { headers }),
    );
    expect(await suffixed.json()).toEqual(prBody);
  });

  it("the authorize endpoint renders a PAGE for a bad redirect_uri — no Location", async () => {
    const { GET } = await import("@/app/api/oauth/authorize/route");
    const c = await client();
    const q = new URLSearchParams({
      client_id: c.clientId,
      redirect_uri: "https://evil.example/cb",
      response_type: "code",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      state: "xyz",
    });
    const res = await GET(
      new Request(`${origin}/api/oauth/authorize?${q}`, { headers: { host: "wizard.test" } }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Redirect address does not match");
    // The attacker's address is NOT reflected into the page.
    expect(html).not.toContain("evil.example");
  });
});
