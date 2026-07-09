import { describe, expect, it } from "vitest";
import { fillDailyGaps } from "@/lib/time-series";

interface Row extends Record<string, unknown> {
  date: string;
  spend: number;
  ctr: number | null;
}

const row = (date: string, spend: number, ctr: number | null): Row => ({
  date,
  spend,
  ctr,
});

const OPTS = { dateKey: "date", additiveKeys: ["spend"], ratioKeys: ["ctr"] } as const;

describe("fillDailyGaps", () => {
  it("fills an interior gap with 0 for additive and null for ratio keys", () => {
    const out = fillDailyGaps<Row>(
      [row("2026-04-01", 10, 0.5), row("2026-04-04", 20, 0.25)],
      OPTS,
    );
    expect(out.map((r) => r.date)).toEqual([
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
      "2026-04-04",
    ]);
    expect(out[1]).toEqual({ date: "2026-04-02", spend: 0, ctr: null });
    expect(out[2]).toEqual({ date: "2026-04-03", spend: 0, ctr: null });
    // Real rows untouched.
    expect(out[0]!.spend).toBe(10);
    expect(out[3]!.ctr).toBe(0.25);
  });

  it("does not invent days before the first or after the last data day", () => {
    const out = fillDailyGaps<Row>(
      [row("2026-04-10", 1, null), row("2026-04-12", 2, null)],
      OPTS,
    );
    expect(out[0]!.date).toBe("2026-04-10");
    expect(out[out.length - 1]!.date).toBe("2026-04-12");
    expect(out).toHaveLength(3);
  });

  it("leaves a single-day series and an empty series unchanged", () => {
    const single = [row("2026-04-01", 5, 0.1)];
    expect(fillDailyGaps<Row>(single, OPTS)).toEqual(single);
    expect(fillDailyGaps<Row>([], OPTS)).toEqual([]);
  });

  it("leaves a continuous series unchanged", () => {
    const rows = [
      row("2026-04-01", 1, 0.1),
      row("2026-04-02", 2, 0.2),
      row("2026-04-03", 3, 0.3),
    ];
    expect(fillDailyGaps<Row>(rows, OPTS)).toEqual(rows);
  });

  it("crosses month and year boundaries in UTC", () => {
    const month = fillDailyGaps<Row>(
      [row("2026-04-29", 1, null), row("2026-05-02", 1, null)],
      OPTS,
    );
    expect(month.map((r) => r.date)).toEqual([
      "2026-04-29",
      "2026-04-30",
      "2026-05-01",
      "2026-05-02",
    ]);
    const year = fillDailyGaps<Row>(
      [row("2025-12-30", 1, null), row("2026-01-02", 1, null)],
      OPTS,
    );
    expect(year.map((r) => r.date)).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
    // Leap-year February.
    const leap = fillDailyGaps<Row>(
      [row("2024-02-27", 1, null), row("2024-03-01", 1, null)],
      OPTS,
    );
    expect(leap.map((r) => r.date)).toEqual([
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
  });

  it("multi-series: each group fills over its OWN first→last span", () => {
    interface GRow extends Row {
      key: string;
      name: string;
    }
    const g = (key: string, date: string, spend: number): GRow => ({
      key,
      name: `label-${key}`,
      date,
      spend,
      ctr: 0.1,
    });
    const out = fillDailyGaps<GRow>(
      [
        // Series A: 01 → 04 (gap 02–03). Series B: 03 → 05 (gap 04).
        g("a", "2026-04-01", 10),
        g("b", "2026-04-03", 30),
        g("a", "2026-04-04", 40),
        g("b", "2026-04-05", 50),
      ],
      { ...OPTS, groupKey: "key" },
    );
    const a = out.filter((r) => r.key === "a");
    const b = out.filter((r) => r.key === "b");
    expect(a.map((r) => [r.date, r.spend])).toEqual([
      ["2026-04-01", 10],
      ["2026-04-02", 0],
      ["2026-04-03", 0],
      ["2026-04-04", 40],
    ]);
    // B does NOT get 04-01/02 (before its own first day).
    expect(b.map((r) => [r.date, r.spend])).toEqual([
      ["2026-04-03", 30],
      ["2026-04-04", 0],
      ["2026-04-05", 50],
    ]);
    // Identity fields copied onto filled rows; ratio nulled.
    const filledA = a[1]!;
    expect(filledA.name).toBe("label-a");
    expect(filledA.ctr).toBeNull();
    // Output is globally date-ascending.
    const dates = out.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("does not mutate the input rows", () => {
    const input = [row("2026-04-01", 10, 0.5), row("2026-04-03", 20, 0.25)];
    const snapshot = JSON.parse(JSON.stringify(input));
    fillDailyGaps<Row>(input, OPTS);
    expect(input).toEqual(snapshot);
  });
});
