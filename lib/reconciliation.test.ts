import { describe, expect, it } from "vitest";
import {
  reconDelta,
  reconDeltaPct,
  reconDeltaTone,
  reconMatchRate,
  isWithinAttributionLag,
  RECON_WARN_THRESHOLD,
} from "@/lib/reconciliation";

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
