import { describe, expect, it } from "vitest";
import {
  hashToken,
  mintTokenSecret,
  timingSafeEqualHex,
  TOKEN_PREFIX,
} from "@/lib/api-token";

// Pure helpers only (no DB). The create/verify/revoke round-trip against the
// real table lives in tests/db/api-token.test.ts.

describe("mintTokenSecret", () => {
  it("mints a cwz_-prefixed secret with a 40+ char body and a 12-char display prefix", () => {
    const { raw, prefix } = mintTokenSecret();
    expect(raw.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(raw.length).toBeGreaterThanOrEqual(TOKEN_PREFIX.length + 40);
    // Prefix = cwz_ + first 8 body chars → exactly 12 chars, a strict prefix of raw.
    expect(prefix).toHaveLength(12);
    expect(raw.startsWith(prefix)).toBe(true);
  });

  it("is unique across mints (randomBytes)", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => mintTokenSecret().raw));
    expect(secrets.size).toBe(50);
  });
});

describe("hashToken", () => {
  it("is a stable 64-char sha256 hex, different per input", () => {
    const h = hashToken("cwz_abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("cwz_abc")).toBe(h);
    expect(hashToken("cwz_abd")).not.toBe(h);
  });
});

describe("timingSafeEqualHex (constant-time compare)", () => {
  it("true for identical hex", () => {
    const h = hashToken("secret");
    expect(timingSafeEqualHex(h, h)).toBe(true);
  });

  it("false for a one-nibble difference (same length)", () => {
    const a = "a".repeat(64);
    const b = "a".repeat(63) + "b";
    expect(timingSafeEqualHex(a, b)).toBe(false);
  });

  it("false (no throw) for different lengths or empty", () => {
    expect(timingSafeEqualHex("abcd", "abcdef")).toBe(false);
    expect(timingSafeEqualHex("", "")).toBe(false);
  });
});
