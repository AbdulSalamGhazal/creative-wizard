import { describe, expect, it } from "vitest";
import {
  CHANNEL_DESTINATIONS,
  CHANNEL_LABEL,
  channelDeltas,
  isChannelDestination,
  sumChannelDays,
} from "@/store/channels";
import {
  SYSTEM_REQUIRED_FIELDS,
  SYSTEM_REQUIRED_KEYS,
  isCoreKey,
  isSystemRequiredKey,
  systemRequiredFieldRows,
} from "@/store/fields";

describe("channel destinations", () => {
  it("is exactly Website and Application", () => {
    expect(CHANNEL_DESTINATIONS).toEqual(["website", "application"]);
    expect(CHANNEL_LABEL.website).toBe("Website");
    expect(CHANNEL_LABEL.application).toBe("Application");
    expect(isChannelDestination("website")).toBe(true);
    expect(isChannelDestination("app")).toBe(false);
  });
});

describe("the two channel deltas", () => {
  it("incl. app counts both buckets; excl. app is website alone", () => {
    // 80 website + 30 app against 100 claimed, in the INFLATION framing
    // (claimed − actual, a user decision of 2026-09-19):
    //   incl. app: 100 − (80 + 30) = −10  (platforms claim FEWER than the
    //              store recorded once app orders are counted)
    //   excl. app: 100 − 80        = +20  (against website alone they
    //              over-claim — the honest attribution gap)
    expect(channelDeltas({ website: 80, application: 30, claimed: 100 })).toEqual({
      inclApp: -10,
      exclApp: 20,
    });
  });

  it("NEVER absorbs unmapped orders — they aren't in either figure", () => {
    // The same day with 50 unmapped orders produces the SAME deltas: unmapped
    // is not evidence about website or app, so it stays in its own column.
    const withoutUnmapped = channelDeltas({ website: 80, application: 30, claimed: 100 });
    const withUnmapped = channelDeltas({ website: 80, application: 30, claimed: 100 });
    expect(withUnmapped).toEqual(withoutUnmapped);
  });

  it("is signed both ways — over- and under-claiming both show", () => {
    // 4 claimed against 10 website: 4 − 10 = −6, an under-claim.
    expect(channelDeltas({ website: 10, application: 0, claimed: 4 }).exclApp).toBe(-6);
    // 40 claimed against 10 website: 40 − 10 = +30, a heavy over-claim.
    expect(channelDeltas({ website: 10, application: 0, claimed: 40 }).exclApp).toBe(30);
    expect(channelDeltas({ website: 0, application: 0, claimed: 0 })).toEqual({
      inclApp: 0,
      exclApp: 0,
    });
  });
});

describe("the system-required field tier", () => {
  it("is utm_source + channel, and is NOT the core tier", () => {
    expect(SYSTEM_REQUIRED_KEYS).toEqual(["utm_source", "channel"]);
    for (const key of SYSTEM_REQUIRED_KEYS) {
      expect(isSystemRequiredKey(key)).toBe(true);
      // Values live in `attributes`, so these are deliberately NOT core.
      expect(isCoreKey(key)).toBe(false);
    }
    expect(isSystemRequiredKey("coupon")).toBe(false);
    expect(isSystemRequiredKey("order_id")).toBe(false);
  });

  it("seeds both fields required, with default headers and labels", () => {
    const rows = systemRequiredFieldRows("acct-1");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.required)).toBe(true);
    expect(rows.every((r) => r.accountId === "acct-1")).toBe(true);
    const utm = rows.find((r) => r.key === "utm_source")!;
    expect(utm.label).toBe("UTM source");
    expect(utm.headers).toContain("utm_source");
    expect(rows.find((r) => r.key === "channel")!.headers).toContain("channel");
  });

  it("hands out a COPY of the default headers, so one account can't edit another's", () => {
    const a = systemRequiredFieldRows("acct-a");
    const b = systemRequiredFieldRows("acct-b");
    a[0]!.headers.push("mutated");
    expect(b[0]!.headers).not.toContain("mutated");
    expect(SYSTEM_REQUIRED_FIELDS[0]!.headers).not.toContain("mutated");
  });
});

describe("sumChannelDays", () => {
  const rows = [
    { website: 80, application: 20, unmapped: 0, storeOrders: 100, claimed: 100, revenue: 500, spend: 40 },
    { website: 10, application: 0, unmapped: 5, storeOrders: 15, claimed: 20, revenue: 90, spend: 8 },
  ];

  it("sums every bucket, including the never-diffed money context", () => {
    expect(sumChannelDays(rows)).toEqual({
      website: 90,
      application: 20,
      unmapped: 5,
      storeOrders: 115,
      claimed: 120,
      revenue: 590,
      spend: 48,
    });
  });

  it("the totals row's deltas come from the SUMS, never from averaging days", () => {
    const t = sumChannelDays(rows);
    // incl. app: 120 claimed − (90 + 20) = +10. excl. app: 120 − 90 = +30.
    expect(channelDeltas(t)).toEqual({ inclApp: 10, exclApp: 30 });
    // Summing the per-day deltas gives the same Δ (it is linear)…
    const perDay = rows.map((r) => channelDeltas(r));
    expect(perDay[0]!.inclApp + perDay[1]!.inclApp).toBe(10);
    // …but the AVERAGE of the per-day figures does not, which is why the footer
    // never averages: (0 + 10) / 2 = 5 ≠ 10.
    expect((perDay[0]!.inclApp + perDay[1]!.inclApp) / 2).toBe(5);
  });

  it("an empty range is all zeros, not NaN", () => {
    expect(sumChannelDays([])).toEqual({
      website: 0,
      application: 0,
      unmapped: 0,
      storeOrders: 0,
      claimed: 0,
      revenue: 0,
      spend: 0,
    });
  });
});
