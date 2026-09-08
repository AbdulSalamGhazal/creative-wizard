import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATING_CONFIG,
  DEFAULT_RATING_RULES,
  rateBlock,
  rulesForScope,
  type RatingConfig,
} from "@/lib/rating";

/**
 * Rating is banding, not a formula: two thresholds and a spend floor. The
 * boundaries are what actually matter — a creative sitting exactly on
 * `goodRoas` must read Good, and one a hair under `minSpend` must read N/A no
 * matter how good its ROAS looks.
 */
describe("rateBlock — threshold banding", () => {
  const rules = { minSpend: 500, goodRoas: 4, decentRoas: 2 };

  it("bands strictly above/at each threshold", () => {
    expect(rateBlock({ spend: 1000, roas: 4 }, rules)).toBe("good"); // exactly good
    expect(rateBlock({ spend: 1000, roas: 4.01 }, rules)).toBe("good");
    expect(rateBlock({ spend: 1000, roas: 3.99 }, rules)).toBe("decent");
    expect(rateBlock({ spend: 1000, roas: 2 }, rules)).toBe("decent"); // exactly decent
    expect(rateBlock({ spend: 1000, roas: 1.99 }, rules)).toBe("bad");
    expect(rateBlock({ spend: 1000, roas: 0 }, rules)).toBe("bad");
  });

  it("the spend floor wins over any ROAS — that's the point of it", () => {
    // A 20× ROAS on $1 of spend is noise, not a result.
    expect(rateBlock({ spend: 499.99, roas: 20 }, rules)).toBe("na");
    expect(rateBlock({ spend: 500, roas: 20 }, rules)).toBe("good"); // exactly at the floor
  });

  it("undefined ROAS or a missing block is N/A, never bad", () => {
    // No conversions ⇒ ROAS is undefined, which is NOT the same as ROAS 0.
    expect(rateBlock({ spend: 1000, roas: null }, rules)).toBe("na");
    expect(rateBlock(undefined, rules)).toBe("na");
    expect(rateBlock(null, rules)).toBe("na");
  });
});

describe("rulesForScope — platform overrides", () => {
  const config: RatingConfig = {
    default: { minSpend: 500, goodRoas: 4, decentRoas: 2 },
    byPlatform: { tiktok: { minSpend: 100, goodRoas: 2, decentRoas: 1 } },
  };

  it("the blended total always uses the default, never a platform override", () => {
    expect(rulesForScope(config, "total")).toEqual(config.default);
  });

  it("a platform with an override uses it; one without falls back", () => {
    expect(rulesForScope(config, "tiktok")).toEqual(config.byPlatform.tiktok);
    expect(rulesForScope(config, "instagram")).toEqual(config.default);
  });

  it("the override genuinely changes the banding, not just the numbers", () => {
    const block = { spend: 200, roas: 2.5 };
    // Default rules: under the $500 floor entirely.
    expect(rateBlock(block, rulesForScope(config, "instagram"))).toBe("na");
    // TikTok's looser floor + thresholds put the same block in Good.
    expect(rateBlock(block, rulesForScope(config, "tiktok"))).toBe("good");
  });

  it("the shipped default config has no overrides and sane defaults", () => {
    expect(DEFAULT_RATING_CONFIG.default).toEqual(DEFAULT_RATING_RULES);
    expect(DEFAULT_RATING_CONFIG.byPlatform).toEqual({});
    expect(DEFAULT_RATING_RULES.goodRoas).toBeGreaterThan(
      DEFAULT_RATING_RULES.decentRoas,
    );
  });
});
