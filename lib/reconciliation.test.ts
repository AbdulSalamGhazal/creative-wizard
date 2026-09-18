import { describe, expect, it } from "vitest";
import {
  reconDelta,
  reconDeltaPct,
  reconDeltaTone,
  reconMatchRate,
  isWithinAttributionLag,
  unattributedShare,
  sumPlatformDays,
  RECON_WARN_THRESHOLD,
  type PlatformDayRow,
} from "@/lib/reconciliation";
import { compareSortValues } from "@/components/ui/data-table";

describe("reconDelta / reconDeltaPct", () => {
  it("Δ is claimed − store, the INFLATION framing (signed both ways)", () => {
    // store 10, claimed 7 → platforms claim 3 FEWER than actually happened.
    expect(reconDelta(10, 7)).toBe(-3);
    // store 7, claimed 10 → platforms claim 3 MORE: an over-claim is positive.
    expect(reconDelta(7, 10)).toBe(3);
    expect(reconDelta(0, 0)).toBe(0);
  });

  it("the canonical case: 80 actual, 100 claimed → +20 / +25%", () => {
    // The direction here is a USER DECISION (2026-09-19) that SUPERSEDES the
    // original store − claimed. Positive = platforms claim more than the store
    // recorded. If this test ever "fails" after a refactor, the refactor is
    // wrong — not this expectation.
    expect(reconDelta(80, 100)).toBe(20);
    expect(reconDeltaPct(80, 100)).toBeCloseTo(0.25, 6);
  });

  it("Δ% is null when store = 0 (even if claimed > 0)", () => {
    expect(reconDeltaPct(0, 0)).toBeNull();
    expect(reconDeltaPct(0, 5)).toBeNull();
  });

  it("Δ% divides by the STORE side; under-claim is negative", () => {
    // (7 − 10) / 10
    expect(reconDeltaPct(10, 7)).toBeCloseTo(-0.3, 6);
    // (12 − 10) / 10 — over-claim, positive.
    expect(reconDeltaPct(10, 12)).toBeCloseTo(0.2, 6);
    expect(reconDeltaPct(10, 10)).toBe(0);
  });
});

describe("reconMatchRate", () => {
  it("is claimed / store; null when store = 0", () => {
    expect(reconMatchRate(10, 7)).toBeCloseTo(0.7, 6);
    expect(reconMatchRate(0, 5)).toBeNull();
    expect(reconMatchRate(0, 0)).toBeNull();
  });
  it("exceeds 1 on over-claim (not clamped)", () => {
    expect(reconMatchRate(10, 12)).toBeCloseTo(1.2, 6);
  });
});

describe("reconDeltaTone", () => {
  it("null (store=0) is muted", () => {
    expect(reconDeltaTone(null)).toBe("muted");
  });
  it("warn only when |Δ%| ≥ threshold; both directions", () => {
    expect(reconDeltaTone(0.1)).toBe("muted");
    expect(reconDeltaTone(RECON_WARN_THRESHOLD)).toBe("warn");
    expect(reconDeltaTone(-RECON_WARN_THRESHOLD)).toBe("warn"); // under-claim is a discrepancy too
    expect(reconDeltaTone(0.9)).toBe("warn");
  });
});

describe("isWithinAttributionLag", () => {
  const horizon = "2026-08-10";
  it("no horizon → never a lag day", () => {
    expect(isWithinAttributionLag("2026-08-10", null)).toBe(false);
  });
  it("the horizon day and the prior 6 days are lag days (7-day window)", () => {
    expect(isWithinAttributionLag("2026-08-10", horizon)).toBe(true);
    expect(isWithinAttributionLag("2026-08-04", horizon)).toBe(true); // 6 days before
    expect(isWithinAttributionLag("2026-08-03", horizon)).toBe(false); // 7 days before
  });
  it("days after the horizon are not lag days", () => {
    expect(isWithinAttributionLag("2026-08-11", horizon)).toBe(false);
  });
});

describe("unattributedShare", () => {
  it("is unattributed ÷ store total", () => {
    expect(unattributedShare(25, 100)).toBeCloseTo(0.25, 9);
    expect(unattributedShare(0, 100)).toBe(0);
    expect(unattributedShare(100, 100)).toBe(1);
  });

  it("is NULL when the store recorded nothing — a share of zero is undefined", () => {
    // The Platforms table renders this as "—", never as 0%.
    expect(unattributedShare(0, 0)).toBeNull();
    expect(unattributedShare(5, 0)).toBeNull();
  });
});

describe("sumPlatformDays", () => {
  const platforms = ["instagram", "tiktok"] as const;
  const rows: PlatformDayRow[] = [
    {
      storeByPlatform: { instagram: 10, tiktok: 4 },
      claimedByPlatform: { instagram: 14, tiktok: 4 },
      unattributed: 6,
      storeOrders: 20,
    },
    {
      storeByPlatform: { instagram: 90 },
      claimedByPlatform: { instagram: 99, tiktok: 1 },
      unattributed: 10,
      storeOrders: 100,
    },
  ];

  it("sums each component, treating a missing platform as 0", () => {
    const t = sumPlatformDays(rows, platforms);
    expect(t.store).toEqual({ instagram: 100, tiktok: 4 });
    expect(t.claimed).toEqual({ instagram: 113, tiktok: 5 });
    expect(t.unattributed).toBe(16);
    expect(t.storeOrders).toBe(120);
  });

  it("the totals row's Δ% comes FROM the sums, not from averaging the days", () => {
    const t = sumPlatformDays(rows, platforms);
    // Instagram: 113 claimed vs 100 store → +13 / +13%.
    expect(reconDelta(t.store.instagram!, t.claimed.instagram!)).toBe(13);
    expect(reconDeltaPct(t.store.instagram!, t.claimed.instagram!)).toBeCloseTo(0.13, 9);
    // The mean of the daily Δ% is (40% + 10%) / 2 = 25% — a different, wrong
    // number. The big day must dominate, and it does.
    const daily = rows.map((r) =>
      reconDeltaPct(r.storeByPlatform.instagram ?? 0, r.claimedByPlatform.instagram ?? 0)!,
    );
    expect((daily[0]! + daily[1]!) / 2).toBeCloseTo(0.25, 9);

    // Same for the unattributed share: 16/120, not the mean of 30% and 10%.
    expect(unattributedShare(t.unattributed, t.storeOrders)).toBeCloseTo(0.1333333, 6);
  });

  it("empty range → zeroed buckets for every known platform", () => {
    expect(sumPlatformDays([], platforms)).toEqual({
      store: { instagram: 0, tiktok: 0 },
      claimed: { instagram: 0, tiktok: 0 },
      unattributed: 0,
      storeOrders: 0,
    });
  });
});

describe("sorting a Δ% column", () => {
  // The Reconciliation tables sort Δ% by SIGNED value (an over-claim of +80% is
  // the top of the range, not the same as −80%), with "—" (store 0 → null)
  // parked at the bottom in BOTH directions.
  const pcts = [0.8, -0.8, null, 0.1];
  const sortBy = (dir: "asc" | "desc") =>
    [...pcts].sort((a, b) => compareSortValues(a, b, dir));

  it("ascending: most negative first, nulls last", () => {
    expect(sortBy("asc")).toEqual([-0.8, 0.1, 0.8, null]);
  });

  it("descending: biggest over-claim first, nulls STILL last", () => {
    expect(sortBy("desc")).toEqual([0.8, 0.1, -0.8, null]);
  });
});
