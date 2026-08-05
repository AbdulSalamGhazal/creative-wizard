import { describe, expect, it } from "vitest";
import { storeCleanupFiltersSchema } from "@/validators/store";

describe("storeCleanupFiltersSchema", () => {
  it("rejects an empty selection (no filter set)", () => {
    const res = storeCleanupFiltersSchema.safeParse({});
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toMatch(/at least one filter/i);
    }
  });

  it("rejects a half-open date range as no filter", () => {
    expect(storeCleanupFiltersSchema.safeParse({ from: "2026-01-01" }).success).toBe(false);
    expect(storeCleanupFiltersSchema.safeParse({ to: "2026-01-31" }).success).toBe(false);
  });

  it("accepts a full date range, a batch id, or order ids", () => {
    expect(
      storeCleanupFiltersSchema.safeParse({ from: "2026-01-01", to: "2026-01-31" }).success,
    ).toBe(true);
    expect(
      storeCleanupFiltersSchema.safeParse({
        batchId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      }).success,
    ).toBe(true);
    expect(storeCleanupFiltersSchema.safeParse({ orderIds: ["SALLA-1"] }).success).toBe(true);
  });

  it("defaults orderIds to an empty array and rejects a bad date/uuid", () => {
    const ok = storeCleanupFiltersSchema.safeParse({ from: "2026-01-01", to: "2026-01-31" });
    expect(ok.success && ok.data.orderIds).toEqual([]);
    expect(storeCleanupFiltersSchema.safeParse({ from: "01-01-2026", to: "2026-01-31" }).success).toBe(false);
    expect(storeCleanupFiltersSchema.safeParse({ batchId: "not-a-uuid" }).success).toBe(false);
  });
});
