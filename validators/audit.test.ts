import { describe, expect, it } from "vitest";
import { parseAuditBefore } from "@/validators/audit";

describe("audit log cursor (R-117)", () => {
  it("takes a positive integer id", () => {
    expect(parseAuditBefore("4021")).toBe(4021);
  });
  it("anything else starts at the newest", () => {
    for (const raw of [undefined, "", "0", "-3", "1.5", "abc"]) {
      expect(parseAuditBefore(raw)).toBeUndefined();
    }
  });
});
