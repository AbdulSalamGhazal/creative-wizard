import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_METRIC, parseDashboardMetric } from "./dashboard-metric";

describe("parseDashboardMetric", () => {
  it("accepts every known metric", () => {
    for (const m of ["spend", "revenue", "conversions", "cpa", "roas"]) {
      expect(parseDashboardMetric(m)).toBe(m);
    }
  });

  it("falls back to the default for anything else", () => {
    expect(parseDashboardMetric(null)).toBe(DEFAULT_DASHBOARD_METRIC);
    expect(parseDashboardMetric(undefined)).toBe(DEFAULT_DASHBOARD_METRIC);
    expect(parseDashboardMetric("")).toBe(DEFAULT_DASHBOARD_METRIC);
    expect(parseDashboardMetric("ROAS")).toBe(DEFAULT_DASHBOARD_METRIC);
    expect(parseDashboardMetric("ctr")).toBe(DEFAULT_DASHBOARD_METRIC);
  });
});
