import { describe, expect, it } from "vitest";
import { canHoldSession, memberStatus } from "@/lib/team-lifecycle";

describe("memberStatus (D4)", () => {
  it("reads the two stamps as three states, removed winning", () => {
    expect(memberStatus({ deactivatedAt: null, removedAt: null })).toBe("active");
    expect(memberStatus({ deactivatedAt: new Date(), removedAt: null })).toBe("deactivated");
    expect(memberStatus({ deactivatedAt: null, removedAt: new Date() })).toBe("removed");
    expect(memberStatus({ deactivatedAt: new Date(), removedAt: new Date() })).toBe("removed");
    // ISO strings, as the client receives them
    expect(memberStatus({ deactivatedAt: "2026-11-06T00:00:00Z", removedAt: null })).toBe("deactivated");
  });
  it("only an active member holds a session or a token", () => {
    expect(canHoldSession({ deactivatedAt: null, removedAt: null })).toBe(true);
    expect(canHoldSession({ deactivatedAt: new Date(), removedAt: null })).toBe(false);
    expect(canHoldSession({ deactivatedAt: null, removedAt: new Date() })).toBe(false);
  });
});
