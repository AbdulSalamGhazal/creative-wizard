import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_PREFIX,
  AUTHORIZE_PATH,
  DEFAULT_SCOPE,
  REFRESH_TOKEN_PREFIX,
  authorizationServerMetadata,
  canonicalOrigin,
  isAllowedRedirectUri,
  isRegisterableRedirectUri,
  protectedResourceMetadata,
  s256Challenge,
  wwwAuthenticateHeader,
  type OauthClientRow,
} from "@/lib/oauth";
import { checkAuthorizeRequest, clientRedirect, readAuthorizeParams } from "@/lib/oauth-authorize";

/**
 * The pure half of the OAuth server. The database-backed rules (single-use
 * codes, rotation, reuse detection, revocation) are pinned against real
 * Postgres in tests/db/oauth.test.ts — a race condition cannot be unit-tested.
 */

const client: OauthClientRow = {
  id: "11111111-1111-1111-1111-111111111111",
  clientName: "Claude",
  redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
  tokenEndpointAuthMethod: "none",
  clientSecretHash: null,
};

describe("PKCE S256", () => {
  it("matches the RFC 7636 appendix B test vector", () => {
    // The spec's own verifier → challenge pair. If this breaks, every exchange
    // in the wild breaks with it.
    expect(s256Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("is base64url with no padding — a `=` or `+` here breaks interop", () => {
    const out = s256Challenge("a".repeat(43));
    expect(out).not.toContain("=");
    expect(out).not.toContain("+");
    expect(out).not.toContain("/");
    expect(out).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is sensitive to every character of the verifier", () => {
    expect(s256Challenge("verifier-one")).not.toBe(s256Challenge("verifier-onf"));
  });
});

describe("redirect_uri rules", () => {
  it("registers only absolute https URLs", () => {
    expect(isRegisterableRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isRegisterableRedirectUri("http://claude.ai/cb")).toBe(false);
    // Loopback http is refused BY DECISION — those clients use a cwz_ key.
    expect(isRegisterableRedirectUri("http://localhost:6274/callback")).toBe(false);
    expect(isRegisterableRedirectUri("https://claude.ai/cb#frag")).toBe(false);
    expect(isRegisterableRedirectUri("https://*.claude.ai/cb")).toBe(false);
    expect(isRegisterableRedirectUri("/relative")).toBe(false);
    expect(isRegisterableRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isRegisterableRedirectUri(42)).toBe(false);
  });

  it("matches EXACTLY at authorize time — near misses are not close enough", () => {
    expect(isAllowedRedirectUri(client, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    for (const near of [
      "https://claude.ai/api/mcp/auth_callback/",
      "https://claude.ai/api/mcp/auth_callback?x=1",
      "https://claude.ai/api/mcp/Auth_callback",
      "https://claude.ai.evil.com/api/mcp/auth_callback",
      "https://claude.ai/api/mcp/auth_callback#f",
      "HTTPS://claude.ai/api/mcp/auth_callback",
    ]) {
      expect(isAllowedRedirectUri(client, near), near).toBe(false);
    }
  });
});

describe("the authorize request check", () => {
  const params = (over: Record<string, string> = {}) =>
    readAuthorizeParams(
      new URL(
        `https://wizard.test${AUTHORIZE_PATH}?` +
          new URLSearchParams({
            client_id: client.id,
            redirect_uri: client.redirectUris[0]!,
            response_type: "code",
            code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            code_challenge_method: "S256",
            state: "xyz",
            ...over,
          }).toString(),
      ),
    );

  it("accepts a well-formed request", () => {
    const res = checkAuthorizeRequest(params(), client);
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") expect(res.scope).toBe(DEFAULT_SCOPE);
  });

  it("renders a PAGE (never a redirect) when the client or redirect can't be trusted", () => {
    // These four are the open-redirect guard. A redirect here would hand an
    // authorization code to whoever asked.
    expect(checkAuthorizeRequest(params({ client_id: "" }), null).kind).toBe("page_error");
    expect(checkAuthorizeRequest(params(), null).kind).toBe("page_error");
    expect(checkAuthorizeRequest(params({ redirect_uri: "" }), client).kind).toBe("page_error");
    expect(
      checkAuthorizeRequest(params({ redirect_uri: "https://evil.example/cb" }), client).kind,
    ).toBe("page_error");
  });

  it("redirects the error home once the client IS verified", () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ code_challenge: "" }, "invalid_request"],
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ scope: "admin" }, "invalid_scope"],
    ];
    for (const [over, error] of cases) {
      const res = checkAuthorizeRequest(params(over), client);
      expect(res.kind, error).toBe("redirect_error");
      if (res.kind === "redirect_error") expect(res.error).toBe(error);
    }
  });
});

describe("the redirect back to the client", () => {
  it("echoes state untouched and keeps the URI's own query", () => {
    const url = clientRedirect("https://claude.ai/cb?keep=1", { code: "abc" }, "a b&c=d");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://claude.ai/cb");
    expect(parsed.searchParams.get("keep")).toBe("1");
    expect(parsed.searchParams.get("code")).toBe("abc");
    expect(parsed.searchParams.get("state")).toBe("a b&c=d");
  });

  it("omits state entirely when the client sent none", () => {
    const url = clientRedirect("https://claude.ai/cb", { error: "access_denied" }, null);
    expect(new URL(url).searchParams.has("state")).toBe(false);
  });
});

describe("the discovery documents", () => {
  const origin = "https://creative.urjwan.com";

  it("pins the protected-resource metadata", () => {
    expect(protectedResourceMetadata(origin)).toEqual({
      resource: "https://creative.urjwan.com/api/mcp/mcp",
      authorization_servers: ["https://creative.urjwan.com"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:read"],
      resource_name: "Creative Wizard MCP",
      resource_documentation: "https://creative.urjwan.com/account/api",
    });
  });

  it("pins the authorization-server metadata — S256 only, two grants", () => {
    expect(authorizationServerMetadata(origin)).toEqual({
      issuer: "https://creative.urjwan.com",
      authorization_endpoint: "https://creative.urjwan.com/api/oauth/authorize",
      token_endpoint: "https://creative.urjwan.com/api/oauth/token",
      registration_endpoint: "https://creative.urjwan.com/api/oauth/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      scopes_supported: ["mcp:read"],
      service_documentation: "https://creative.urjwan.com/account/api",
    });
  });

  it("the issuer IS the origin the document was fetched from", () => {
    // A mismatch makes a conforming client abort, so these must be one value.
    const meta = authorizationServerMetadata(origin);
    expect(meta.issuer).toBe(origin);
    expect(meta.authorization_endpoint.startsWith(`${meta.issuer}/`)).toBe(true);
    expect(protectedResourceMetadata(origin).authorization_servers[0]).toBe(meta.issuer);
  });

  it("the 401 header points at the protected-resource document", () => {
    expect(wwwAuthenticateHeader(origin, "invalid_token")).toBe(
      'Bearer realm="Wizard MCP", resource_metadata="https://creative.urjwan.com/.well-known/oauth-protected-resource", error="invalid_token"',
    );
  });
});

describe("the canonical origin", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://ignored.test/whatever", { headers });

  it("prefers APP_ORIGIN and strips a trailing slash", () => {
    const before = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = "https://creative.urjwan.com/";
    try {
      expect(canonicalOrigin(req({ host: "vercel.preview" }))).toBe(
        "https://creative.urjwan.com",
      );
    } finally {
      if (before === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = before;
    }
  });

  it("falls back to the forwarded host, and speaks http only to localhost", () => {
    const before = process.env.APP_ORIGIN;
    delete process.env.APP_ORIGIN;
    try {
      expect(canonicalOrigin(req({ "x-forwarded-host": "preview.vercel.app" }))).toBe(
        "https://preview.vercel.app",
      );
      expect(canonicalOrigin(req({ host: "localhost:3000" }))).toBe("http://localhost:3000");
      expect(
        canonicalOrigin(req({ host: "example.test", "x-forwarded-proto": "http" })),
      ).toBe("http://example.test");
    } finally {
      if (before !== undefined) process.env.APP_ORIGIN = before;
    }
  });
});

describe("token prefixes", () => {
  it("are self-identifying and distinct from personal keys", () => {
    expect(ACCESS_TOKEN_PREFIX).toBe("cwz_at_");
    expect(REFRESH_TOKEN_PREFIX).toBe("cwz_rt_");
    // Both still start with cwz_, so the MCP route routes by the LONGER prefix.
    expect(ACCESS_TOKEN_PREFIX.startsWith("cwz_")).toBe(true);
    expect(ACCESS_TOKEN_PREFIX).not.toBe(REFRESH_TOKEN_PREFIX);
  });
});
