import { describe, expect, it } from "vitest";
import {
  reconciliationFiltersSchema,
  storeCleanupFiltersSchema,
  storeInsightsFiltersSchema,
  storeOrdersFiltersSchema,
  storeUtmsFiltersSchema,
} from "@/validators/store";

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

describe("real dates only (2026-10-31)", () => {
  it("the orders page DROPS a malformed or impossible date instead of throwing", () => {
    const f = storeOrdersFiltersSchema.parse({ from: "abc", to: "2026-02-30" });
    expect(f.from).toBeUndefined();
    expect(f.to).toBeUndefined();
    expect(storeOrdersFiltersSchema.parse({ from: "2026-02-01", to: "2026-02-28" })).toMatchObject({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("so do Insights, Reconciliation and UTMs", () => {
    for (const schema of [storeInsightsFiltersSchema, reconciliationFiltersSchema, storeUtmsFiltersSchema]) {
      expect(schema.parse({ from: "2026-02-30", to: "nope" })).toMatchObject({ from: undefined, to: undefined });
    }
  });

  it("the cleanup tool refuses an impossible date", () => {
    expect(storeCleanupFiltersSchema.safeParse({ from: "2026-02-30", to: "2026-03-05" }).success).toBe(false);
  });
});
