import { describe, expect, it } from "vitest";
import { actionError, GENERIC_ACTION_ERROR, isUniqueViolation } from "@/lib/action-error";

describe("isUniqueViolation (W1-13)", () => {
  it("knows Postgres' 23505 by code, by message, or wrapped as a cause", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(
      isUniqueViolation(new Error('duplicate key value violates unique constraint "exclusion_rules_account_campaign_idx"')),
    ).toBe(true);
    expect(isUniqueViolation(new Error("wrapper", { cause: { code: "23505" } }))).toBe(true);
    expect(isUniqueViolation(new Error("connection refused"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
  it("is why callers test the RAW error: actionError has already generalized it", () => {
    const raw = new Error('duplicate key value violates unique constraint "x"');
    expect(actionError(raw, "test")).toBe(GENERIC_ACTION_ERROR);
    expect(isUniqueViolation(raw)).toBe(true);
  });
});
