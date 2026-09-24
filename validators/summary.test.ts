import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  metricConditionLabel,
  parseMetricFilters,
  parseRateFilter,
  parseStatusFilter,
  summaryFiltersSchema,
} from "@/validators/summary";

/** Read a stored view's query string the way the page does. */
function parseQuery(qs: string) {
  return summaryFiltersSchema.parse(Object.fromEntries(new URLSearchParams(qs)));
}

/**
 * The Ads bar moved onto FilterShell (2026-09). The URL params are the
 * contract every saved view is stored against, so they are UNTOUCHED — this
 * pins that a view saved before the migration still applies exactly.
 */
describe("saved views round-trip through the FilterShell bar", () => {
  // Every param the bar can write, in one stored view.
  const VIEW =
    "from=2026-01-01&to=2026-01-31&q=hero&platforms=instagram,facebook&productIds=p1,p2" +
    "&types=video,image&angles=ugc,testimonial&priorities=3,unrated&stages=Awareness,N/A" +
    "&status=instagram:active,pause&rate=total:good&metricFilters=total:roas:gte:2,instagram:spend:gte:500" +
    "&includeExcluded=1&sort=total.spend&dir=desc&hideIdentity=stage,priority&hideMetrics=cpm&hideRate=1&hideBlended=1";

  it("parses every field a stored view carries", () => {
    const f = parseQuery(VIEW);
    expect(f.from).toBe("2026-01-01");
    expect(f.to).toBe("2026-01-31");
    expect(f.q).toBe("hero");
    expect(f.platforms).toEqual(["instagram", "facebook"]);
    expect(f.productIds).toEqual(["p1", "p2"]);
    expect(f.types).toEqual(["video", "image"]);
    expect(f.angles).toEqual(["ugc", "testimonial"]);
    expect(f.priorities).toEqual(["3", "unrated"]);
    expect(f.stages).toEqual(["Awareness", "N/A"]);
    expect(f.includeExcluded).toBe(true);
    expect(f.sort).toBe("total.spend");
    expect(f.dir).toBe("desc");
    expect(f.hideIdentity).toEqual(["stage", "priority"]);
    expect(f.hideMetrics).toEqual(["cpm"]);
    expect(f.hideRate).toBe(true);
    expect(f.hideBlended).toBe(true);
  });

  it("the scoped filters keep their scope:value encoding", () => {
    const params = new URLSearchParams(VIEW);
    expect(parseStatusFilter(params.get("status"))).toEqual({
      scope: "instagram",
      statuses: ["active", "pause"],
    });
    expect(parseRateFilter(params.get("rate"))).toEqual({ scope: "total", ratings: ["good"] });
    expect(parseMetricFilters(params.get("metricFilters"))).toEqual([
      { scope: "total", metric: "roas", op: "gte", value: 2 },
      { scope: "instagram", metric: "spend", op: "gte", value: 500 },
    ]);
  });

  it("a view saved BEFORE the migration (no new params) still parses", () => {
    const old = parseQuery("platforms=instagram&types=video&sort=total.roas&dir=asc");
    expect(old.platforms).toEqual(["instagram"]);
    expect(old.types).toEqual(["video"]);
    expect(old.stages).toEqual([]);
    expect(old.priorities).toEqual([]);
    expect(old.q).toBeUndefined();
  });
});

describe("metricConditionLabel — one wording for the rule builder and the chips", () => {
  it("reads as a sentence, with units and the scope when it isn't the total", () => {
    expect(metricConditionLabel({ scope: "total", metric: "roas", op: "gte", value: 2 })).toBe(
      "ROAS ≥ 2×",
    );
    expect(metricConditionLabel({ scope: "total", metric: "spend", op: "lte", value: 500 })).toBe(
      "Spend ≤ $500",
    );
    expect(metricConditionLabel({ scope: "total", metric: "ctr", op: "eq", value: 1.25 })).toBe(
      "CTR = 1.25%",
    );
    expect(
      metricConditionLabel({ scope: "instagram", metric: "cpa", op: "lte", value: 20 }, (s) =>
        s === "instagram" ? "Instagram" : s,
      ),
    ).toBe("Instagram CPA ≤ $20");
  });
});

/**
 * CLEAR SEMANTICS (user decision): the Ads bar's Clear resets the TIER-2
 * filters only. It can't reach sort, columns, the view, the date range or
 * tier-1 state, because `clearFilters` only walks the declared defs — so the
 * guard is: which keys are declared as filters at all.
 */
describe("the Ads bar declares exactly the tier-2 filters", () => {
  const src = readFileSync("components/summary/summary-filter-bar.tsx", "utf8");
  const declared = [...src.matchAll(/^\s{6}key: "([^"]+)",$/gm)].map((m) => m[1]);

  it("declares the eight panel filters and nothing else", () => {
    expect(declared.sort()).toEqual(
      [
        "angles",
        "metricFilters",
        "priorities",
        "productIds",
        "rate",
        "stages",
        "status",
        "types",
      ].sort(),
    );
  });

  it("never declares a protected param, so Clear can't reach one", () => {
    for (const key of [
      "sort",
      "dir",
      "hideIdentity",
      "hideMetrics",
      "hideRate",
      "hideBlended",
      "view",
      "from",
      "to",
      "q",
      "platforms",
      "includeExcluded",
    ]) {
      expect(declared).not.toContain(key);
    }
  });
});
