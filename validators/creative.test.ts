import { describe, expect, it } from "vitest";
import { prioritySchema } from "@/validators/creative";

// Priority is the team's MANUAL 1..3 importance judgment (null = unrated).
// It must reject anything that isn't an integer 1, 2, 3, or null — no 0 (unrated
// is null, never a numeric 0), no out-of-range, no fractional, no string coercion.
describe("prioritySchema", () => {
  it("accepts 1, 2, 3 and null", () => {
    for (const v of [1, 2, 3, null]) {
      const res = prioritySchema.safeParse(v);
      expect(res.success, `expected ${v} to be valid`).toBe(true);
      if (res.success) expect(res.data).toBe(v);
    }
  });

  it("rejects 0 (unrated is null, not a numeric 0)", () => {
    expect(prioritySchema.safeParse(0).success).toBe(false);
  });

  it("rejects out-of-range (4) and fractional (1.5)", () => {
    expect(prioritySchema.safeParse(4).success).toBe(false);
    expect(prioritySchema.safeParse(1.5).success).toBe(false);
  });

  it("does not coerce a numeric string (\"2\" rejected)", () => {
    expect(prioritySchema.safeParse("2").success).toBe(false);
  });

  it("rejects undefined (the field is .optional() only at the patch layer)", () => {
    expect(prioritySchema.safeParse(undefined).success).toBe(false);
  });
});
