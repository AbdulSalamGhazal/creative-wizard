import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { csvEnum, parseCsvEnum } from "@/validators/shared";
import { summaryFiltersSchema } from "@/validators/summary";
import { dashboardFiltersSchema } from "@/validators/filters";
import { portfolioFiltersSchema } from "@/validators/portfolio";
import { canvasFiltersSchema } from "@/validators/canvas";
import { creativeListFiltersSchema } from "@/validators/creative";
import { storeInsightsFiltersSchema } from "@/validators/store";

/**
 * W3-1: ONE comma-list helper, and it drops only the bad token. Five copies
 * used to disagree — a stale `platforms=meta,instagram` link kept Instagram
 * on the Library and emptied Ads; a saved Ads view naming a retired column
 * re-opened every hidden column. Every filter schema is pinned here.
 */
describe("parseCsvEnum / csvEnum", () => {
  it("keeps valid siblings of an invalid token", () => {
    expect(parseCsvEnum("meta,instagram", ["instagram", "facebook"])).toEqual([
      "instagram",
    ]);
  });
  it("absent, empty and all-invalid are []", () => {
    expect(parseCsvEnum(undefined, ["a"])).toEqual([]);
    expect(parseCsvEnum("", ["a"])).toEqual([]);
    expect(parseCsvEnum(",,", ["a"])).toEqual([]);
    expect(parseCsvEnum("x,y", ["a"])).toEqual([]);
  });
  it("trims parts", () => {
    expect(parseCsvEnum(" a , b", ["a", "b"])).toEqual(["a", "b"]);
  });
  it("never throws on a non-string", () => {
    expect(csvEnum(["a"]).parse(42)).toEqual([]);
  });
});

describe("every filter schema drops only the bad token", () => {
  const stale = "meta,instagram";
  it("Ads", () => {
    expect(summaryFiltersSchema.parse({ platforms: stale }).platforms).toEqual([
      "instagram",
    ]);
  });
  it("Ads saved-view columns keep their valid hidden keys", () => {
    const parsed = summaryFiltersSchema.parse({
      hideIdentity: "priority,retiredKey",
      hideMetrics: "ctr,retired_metric",
    });
    expect(parsed.hideIdentity).toEqual(["priority"]);
    expect(parsed.hideMetrics).toEqual(["ctr"]);
  });
  it("Dashboard / Trends / Funnel", () => {
    expect(
      dashboardFiltersSchema.parse({ platforms: stale }).platforms,
    ).toEqual(["instagram"]);
  });
  it("Campaigns", () => {
    expect(
      portfolioFiltersSchema.parse({ platforms: stale }).platforms,
    ).toEqual(["instagram"]);
  });
  it("Canvas", () => {
    expect(canvasFiltersSchema.parse({ platforms: stale }).platforms).toEqual([
      "instagram",
    ]);
  });
  it("Library", () => {
    expect(
      creativeListFiltersSchema.parse({ platforms: stale }).platforms,
    ).toEqual(["instagram"]);
  });
  it("Store Insights", () => {
    expect(
      storeInsightsFiltersSchema.parse({ platforms: stale }).platforms,
    ).toEqual(["instagram"]);
  });
});

describe("no validator re-declares a comma-list helper", () => {
  it("only validators/shared.ts defines one", () => {
    const dir = join(process.cwd(), "validators");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => f !== "shared.ts")
      .filter((f) =>
        /function\s+(csvEnum|csvOf|csvString|csv)\s*[<(]/.test(
          readFileSync(join(dir, f), "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
