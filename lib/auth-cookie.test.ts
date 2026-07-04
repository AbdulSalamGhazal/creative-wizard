import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

// lib/auth-cookie.ts imports next/headers for the cookie-jar helpers; the pure
// verifySessionToken under test never touches it. Mock it so the module loads
// outside a Next request context.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { verifySessionToken } from "@/lib/auth-cookie";

const SECRET = "test-secret-0123456789abcdef"; // ≥16 chars, matches getSecret()

/** Mint a token in the exact production format:
 *  `<userId>.<issuedAtMs>.<base64url hmac-sha256(userId.issuedAtMs)>`. */
function mint(userId: string, issuedAt: number, secret = SECRET): string {
  const payload = `${userId}.${issuedAt}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

const USER = "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8";

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
});

describe("verifySessionToken", () => {
  it("round-trips a freshly signed token", () => {
    expect(verifySessionToken(mint(USER, Date.now()))).toBe(USER);
  });

  it("rejects a missing token", () => {
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken("")).toBeNull();
  });

  it("rejects a tampered payload (user id swap keeps the old signature invalid)", () => {
    const token = mint(USER, Date.now());
    const other = "00000000-0000-0000-0000-000000000001";
    const forged = other + token.slice(USER.length);
    expect(verifySessionToken(forged)).toBeNull();
  });

  it("rejects a tampered issued-at (extending lifetime invalidates the HMAC)", () => {
    const issued = Date.now();
    const token = mint(USER, issued);
    const parts = token.split(".");
    // token = uuid(no dots) . issuedAt . sig → bump issuedAt, keep sig
    parts[parts.length - 2] = String(issued + 1);
    expect(verifySessionToken(parts.join("."))).toBeNull();
  });

  it("rejects a tampered/truncated signature", () => {
    const token = mint(USER, Date.now());
    expect(verifySessionToken(token.slice(0, -2))).toBeNull();
    expect(verifySessionToken(`${token}xx`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    expect(
      verifySessionToken(mint(USER, Date.now(), "another-secret-xyz-123456")),
    ).toBeNull();
  });

  it("rejects an expired token (31 days old, TTL is 30)", () => {
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    expect(verifySessionToken(mint(USER, old))).toBeNull();
  });

  it("accepts a token just inside the TTL (29 days old)", () => {
    const recent = Date.now() - 29 * 24 * 60 * 60 * 1000;
    expect(verifySessionToken(mint(USER, recent))).toBe(USER);
  });

  it("rejects a future-issued token beyond the 60s clock-skew allowance", () => {
    expect(verifySessionToken(mint(USER, Date.now() + 2 * 60_000))).toBeNull();
  });

  it("tolerates small clock skew (issued 30s in the future)", () => {
    expect(verifySessionToken(mint(USER, Date.now() + 30_000))).toBe(USER);
  });

  it("rejects structural garbage", () => {
    expect(verifySessionToken("no-dots-here")).toBeNull();
    expect(verifySessionToken("a.b")).toBeNull();
    expect(verifySessionToken("..")).toBeNull();
    expect(verifySessionToken(`${USER}.notanumber.AAAA`)).toBeNull();
  });
});
