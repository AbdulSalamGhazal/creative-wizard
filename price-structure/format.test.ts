import { describe, expect, it } from "vitest";
import { fromInput, money0, money2, pct1, pct2, pp1, roas2, signedPct1, targetText, toInput, usd0, usd2 } from "./format";

describe("number formats (§8.1)", () => {
  it("money", () => {
    expect(money2(71.1957)).toBe("71.20");
    expect(money2(-3.5)).toBe("−3.50");
    expect(money0(11918.55)).toBe("11,919");
    expect(money2(Infinity)).toBe("—");
    expect(money2(null)).toBe("—");
  });
  it("percent", () => {
    expect(pct1(0.2752)).toBe("27.5%");
    expect(pct2(0.2752)).toBe("27.52%");
    expect(pct1(NaN)).toBe("—");
  });
  it("roas and usd", () => {
    expect(roas2(3.5897)).toBe("3.59");
    expect(usd2(22.1)).toBe("$22.10");
    expect(usd0(2677.8)).toBe("$2,678");
  });
  it("deltas", () => {
    expect(signedPct1(0.12)).toBe("+12.0%");
    expect(signedPct1(-0.184)).toBe("−18.4%");
    expect(signedPct1(0)).toBe("0.0%");
    expect(pp1(0.034)).toBe("+3.4 pp");
    expect(pp1(-0.034)).toBe("−3.4 pp");
  });
  it("target text", () => {
    expect(targetText("margin", 0.25)).toBe("CML % 25.0%");
    expect(targetText("profit", 60)).toBe("CML / order 60.00");
    expect(targetText("accountantRoas", 2.5)).toBe("Acct. ROAS 2.50");
    expect(targetText("monthlyProfit", 12345.6)).toBe("Monthly CML 12,346");
  });
  it("percent inputs are typed as 25 and stored as 0.25", () => {
    expect(toInput("pct", 0.25)).toBe(25);
    expect(fromInput("pct", 25)).toBe(0.25);
    expect(toInput("sar", 60)).toBe(60);
  });
});
