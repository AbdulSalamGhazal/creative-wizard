import { beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifySessionTokenEdge, SESSION_TTL_MS } from "@/lib/session-edge";
import { verifySessionToken } from "@/lib/auth-cookie";

/**
 * Drift-pinning: a token produced in the canonical cookie format
 * (`<userId>.<issuedAtMs>.<base64url hmac>`) must be accepted by BOTH verifiers —
 * auth-cookie's node:crypto `verifySessionToken` and the Edge Web-Crypto
 * `verifySessionTokenEdge` the middleware uses — and rejected by both on tamper
 * / expiry / future-skew. If either implementation changes its format, TTL, or
 * secret handling, one of these assertions fails.
 */

const SECRET = "test-secret-at-least-16-chars-long";
const USER_ID = "11111111-1111-1111-1111-111111111111";

function signToken(userId: string, issuedAtMs: number, secret = SECRET): string {
  const payload = `${userId}.${issuedAtMs}`;
  const sig = createHmac("sha256", secret).update(payload).digest().toString("base64url");
  return `${payload}.${sig}`;
}

beforeAll(() => {
  // verifySessionToken (node) reads AUTH_SECRET at call time.
  process.env.AUTH_SECRET = SECRET;
});

describe("session verifier drift-pinning (node vs Edge)", () => {
  it("both accept a freshly-signed token", async () => {
    const token = signToken(USER_ID, Date.now());
    expect(verifySessionToken(token)).toBe(USER_ID);
    expect(await verifySessionTokenEdge(token, SECRET)).toBe(true);
  });

  it("both reject a tampered signature", async () => {
    const good = signToken(USER_ID, Date.now());
    const tampered = good.slice(0, -2) + (good.endsWith("aa") ? "bb" : "aa");
    expect(verifySessionToken(tampered)).toBeNull();
    expect(await verifySessionTokenEdge(tampered, SECRET)).toBe(false);
  });

  it("both reject a token signed with a different secret", async () => {
    const token = signToken(USER_ID, Date.now(), "some-other-secret-16chars");
    expect(verifySessionToken(token)).toBeNull();
    expect(await verifySessionTokenEdge(token, SECRET)).toBe(false);
  });

  it("both reject an expired token (older than the shared TTL)", async () => {
    const token = signToken(USER_ID, Date.now() - SESSION_TTL_MS - 1000);
    expect(verifySessionToken(token)).toBeNull();
    expect(await verifySessionTokenEdge(token, SECRET)).toBe(false);
  });

  it("both reject a future-dated token (clock-skew guard)", async () => {
    const token = signToken(USER_ID, Date.now() + 5 * 60 * 1000);
    expect(verifySessionToken(token)).toBeNull();
    expect(await verifySessionTokenEdge(token, SECRET)).toBe(false);
  });

  it("both reject a malformed token", async () => {
    for (const bad of ["", "no-dots", "only.two"]) {
      expect(verifySessionToken(bad)).toBeNull();
      expect(await verifySessionTokenEdge(bad, SECRET)).toBe(false);
    }
  });
});
