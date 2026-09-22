import { describe, expect, it } from "vitest";
import { creativePatchSchema, prioritySchema } from "@/validators/creative";

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

// ── The detail page's patch ──────────────────────────────────────────────────
// Regression: the "something to update?" refine was a hand-written field list
// and `stages` was never added, so a stage-ONLY patch failed with "No fields
// to update." The refine is derived now; these tests pin it per field.
describe("creativePatchSchema", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  /** One valid value per updatable field — each is sent ALONE below. */
  const SAMPLES: Record<string, unknown> = {
    name: "URJ_VID_001",
    productId: "22222222-2222-4222-8222-222222222222",
    type: "video",
    thumbnailUrl: "https://example.com/t.jpg",
    launchDate: "2026-09-01",
    priority: 2,
    stages: ["Retargeting"],
    angles: ["ugc"],
  };

  it("has a sample for EVERY field — a new field must be tested alone too", () => {
    const fields = Object.keys(creativePatchSchema.innerType().shape).filter((k) => k !== "id");
    expect(Object.keys(SAMPLES).sort()).toEqual(fields.sort());
  });

  it("accepts a stages-only patch (the bug)", () => {
    const res = creativePatchSchema.safeParse({ id, stages: ["Awareness"] });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.stages).toEqual(["Awareness"]);
  });

  it("accepts clearing stages alone ([] = unassigned)", () => {
    expect(creativePatchSchema.safeParse({ id, stages: [] }).success).toBe(true);
  });

  it.each(Object.entries(SAMPLES))("accepts %s alone", (field, value) => {
    const res = creativePatchSchema.safeParse({ id, [field]: value });
    expect(res.success).toBe(true);
  });

  it("accepts an explicit null where a field allows it (it IS an update)", () => {
    expect(creativePatchSchema.safeParse({ id, priority: null }).success).toBe(true);
    expect(creativePatchSchema.safeParse({ id, thumbnailUrl: null }).success).toBe(true);
    expect(creativePatchSchema.safeParse({ id, launchDate: null }).success).toBe(true);
  });

  it("rejects { id } alone — there is nothing to update", () => {
    const res = creativePatchSchema.safeParse({ id });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toBe("No fields to update.");
  });

  it("rejects a patch whose only keys are explicitly undefined", () => {
    expect(creativePatchSchema.safeParse({ id, name: undefined, stages: undefined }).success).toBe(
      false,
    );
  });
});
