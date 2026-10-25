import { describe, expect, it } from "vitest";
import { int, num, pct, pct1, roas, sar, signedInt, signedPct, usd, plural } from "@/lib/format";

/**
 * The dash is load-bearing: `—` means "no value", and a real `0` must never
 * render as one (nor the reverse). Most of these guard that boundary.
 */
describe("usd / sar / int — null vs zero", () => {
  it("renders a real zero, dashes a missing one", () => {
    expect(usd(0)).toBe("$0.00");
    expect(usd(null)).toBe("—");
    expect(usd(undefined)).toBe("—");
    expect(usd(Number.NaN)).toBe("—");
    expect(int(0)).toBe("0");
    expect(int(null)).toBe("—");
    expect(sar(0)).toMatch(/^SAR\s0\.00$/);
    expect(sar(null)).toBe("—");
  });

  it("groups thousands and keeps two decimals for money", () => {
    expect(usd(1234.5)).toBe("$1,234.50");
    expect(int(1234567)).toBe("1,234,567");
    expect(sar(1234.5)).toMatch(/^SAR\s1,234\.50$/);
  });

  it("negatives keep their sign", () => {
    expect(usd(-50)).toBe("-$50.00");
  });
});

describe("num — up to 2dp, for values whose precision we don't control", () => {
  it("keeps decimals int() would have rounded away", () => {
    expect(num(12.5)).toBe("12.5");
    expect(num(12.34)).toBe("12.34");
    expect(int(12.5)).toBe("13"); // …which is exactly the difference
  });

  it("drops trailing zeros and still dashes null", () => {
    expect(num(12.0)).toBe("12");
    expect(num(1234.5)).toBe("1,234.5");
    expect(num(null)).toBe("—");
  });
});

describe("roas — the × suffix and the undefined case", () => {
  it("formats to 2dp with ×", () => {
    expect(roas(2)).toBe("2.00×");
    expect(roas(0)).toBe("0.00×"); // a real zero ROAS is a result, not a gap
  });
  it("dashes an undefined ROAS (no spend ⇒ not computable)", () => {
    expect(roas(null)).toBe("—");
    expect(roas(undefined)).toBe("—");
  });
});

describe("pct / pct1 / signedPct", () => {
  it("pct keeps the percent style, pct1 fixes the decimals", () => {
    expect(pct(0)).toBe("0.00%");
    expect(pct(null)).toBe("—");
    expect(pct1(0.1234)).toBe("12.3%"); // 1dp by default
    expect(pct1(0.1234, 2)).toBe("12.34%");
    expect(pct1(0.1234, 0)).toBe("12%");
    expect(pct1(null)).toBe("—");
  });

  it("signedPct leads with + or a real MINUS SIGN, not a hyphen", () => {
    expect(signedPct(0.183)).toBe("+18.3%");
    // U+2212, not "-": at these sizes a hyphen is hard to see at all.
    expect(signedPct(-0.08)).toBe("−8.0%");
    expect(signedPct(-0.08).startsWith("-")).toBe(false);
  });

  it("signedPct leaves zero unsigned — '+0.0%' reads as a change that isn't", () => {
    expect(signedPct(0)).toBe("0.0%");
    expect(signedPct(0.0000001)).toBe("0.0%");
  });

  it("signedPct honours the decimal count and dashes null", () => {
    expect(signedPct(0.183, 0)).toBe("+18%");
    expect(signedPct(null)).toBe("—");
  });
});

describe("plural", () => {
  it("gets the singular case right — the one that used to read '1 orders'", () => {
    expect(plural(1, "order")).toBe("1 order");
    expect(plural(0, "order")).toBe("0 orders");
    expect(plural(2, "order")).toBe("2 orders");
  });
  it("groups the count and takes an irregular plural", () => {
    expect(plural(1234, "row")).toBe("1,234 rows");
    expect(plural(2, "entry", "entries")).toBe("2 entries");
  });
});

describe("compact money renders the SAME on the server and in the browser (W2-10)", () => {
  // Node's ICU formats a compact CURRENCY with the currency's 2-digit minimum
  // clamped to the 1-digit maximum — "$78.0" — while browsers render "$78".
  // The Dashboard's product donut hydrated with that mismatch ("$78" vs
  // "$78.0") and React threw its server HTML away. An explicit minimum of 0
  // makes both engines agree.
  it("whole values carry no trailing .0", async () => {
    const { usdCompact, sarCompact } = await import("@/lib/format");
    expect(usdCompact(78)).toBe("$78");
    expect(usdCompact(77.96)).toBe("$78");
    expect(usdCompact(1000)).toBe("$1K");
    expect(usdCompact(1234)).toBe("$1.2K");
    expect(sarCompact(78)).toBe("SAR\u00a078"); // ICU puts a no-break space after the code
    expect(sarCompact(25_400)).toBe("SAR\u00a025.4K");
  });
});

describe("signedInt — count deltas with the same minus as signedPct", () => {
  it("signs non-zero values and leaves zero bare", () => {
    expect(signedInt(20)).toBe("+20");
    expect(signedInt(-1844)).toBe("−1,844");
    expect(signedInt(0)).toBe("0");
    expect(signedInt(0.4)).toBe("0");
  });
  it("renders null as a dash", () => {
    expect(signedInt(null)).toBe("—");
    expect(signedInt(Number.NaN)).toBe("—");
  });
});
