import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const from = (h: Record<string, string>) => clientIp(new Headers(h));

describe("clientIp — the sign-in throttle's address key (F1)", () => {
  it("takes the FIRST hop of x-forwarded-for — the client, not a proxy", () => {
    expect(from({ "x-forwarded-for": "203.0.113.7, 10.0.0.2, 10.0.0.3" })).toBe("203.0.113.7");
    expect(from({ "x-forwarded-for": "  198.51.100.1  " })).toBe("198.51.100.1");
  });

  it("falls back to x-real-ip", () => {
    expect(from({ "x-real-ip": "198.51.100.9" })).toBe("198.51.100.9");
  });

  it("prefers x-forwarded-for when both are present", () => {
    expect(from({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.9" })).toBe(
      "203.0.113.7",
    );
  });

  it("reads IPv6, lower-cased so one address is one key", () => {
    expect(from({ "x-forwarded-for": "2001:DB8::1" })).toBe("2001:db8::1");
    expect(from({ "x-forwarded-for": "::1" })).toBe("::1");
  });

  it("a value that is not an address is skipped, never a key", () => {
    expect(from({ "x-forwarded-for": "not-an-ip" })).toBeNull();
    expect(from({ "x-forwarded-for": "unknown", "x-real-ip": "198.51.100.9" })).toBe(
      "198.51.100.9",
    );
    expect(from({ "x-forwarded-for": "1".repeat(200) })).toBeNull();
    expect(from({ "x-forwarded-for": "" })).toBeNull();
  });

  it("no header at all → null (the throttle counts by email alone)", () => {
    expect(from({})).toBeNull();
  });
});
