import { describe, expect, it } from "vitest";
import {
  CREATIVE_DAILY_DAYS,
  DIAGNOSIS_INSTRUCTIONS,
  MAX_DIAGNOSIS_CREATIVES,
  MAX_DIAGNOSIS_WEEKS,
  diagnosisConventions,
  nullUnavailable,
  serializeDiagnosis,
  weeklyRollup,
  type DiagnosisDayRow,
  type DiagnosisInput,
} from "@/lib/diagnosis";

// The bundle is read by a model that will act on it. These tests pin the two
// things that make it trustworthy: the SHAPE (caps, nulls, rollups) and the
// WORDS (conventions + instructions), because a careless edit to either
// degrades every diagnosis silently and invisibly.

const day = (date: string, over: Partial<DiagnosisDayRow> = {}): DiagnosisDayRow => ({
  date,
  records: 4,
  spend: 100,
  impressions: 10_000,
  clicks: 200,
  conversions: 5,
  conversionValue: 500,
  landingPageViews: 150,
  addToCart: 40,
  addPayment: 12,
  videoViews2s: 3_000,
  videoViews25: 1_500,
  videoViews50: 900,
  videoViews75: 500,
  videoViews100: 300,
  ...over,
});

function input(over: Partial<DiagnosisInput> = {}): DiagnosisInput {
  return {
    generatedAt: "2026-10-03T08:00:00.000Z",
    brand: { id: "acct-a", name: "Urjwan" },
    campaign: {
      name: "Ramadan ➤ Broad (IG)",
      objective: "Sales",
      platform: "instagram",
      platforms: ["instagram"],
      status: "active",
      products: ["Serum"],
      creativeCount: 3,
      firstDate: "2026-06-01",
      lastDate: "2026-10-02",
    },
    window: { from: "2026-09-04", to: "2026-10-03", days: 30 },
    excludedRecords: "hidden",
    coverage: { instagram: "2026-10-02", tiktok: null },
    days: [day("2026-09-04"), day("2026-09-05")],
    lifetime: { spend: 54_000, conversionValue: 120_000, roas: 2.22 },
    creatives: [],
    creativesTotal: 0,
    benchmarks: {
      platform: "instagram",
      spend: 20_000,
      cpm: 9.4,
      ctr: 0.012,
      cvr: 0.031,
      roas: 2.6,
      aov: 410,
      funnel: {
        voc: 0.62,
        atcRate: 0.21,
        apRate: 0.4,
        purchaseRate: 0.55,
        cvr: 0.031,
        ctr: 0.012,
        cpm: 9.4,
      },
    },
    budget: {
      month: "2026-10",
      planMode: "curve",
      bucket: "Other",
      platform: "instagram",
      plan: 9_000,
      expectedAtCoverage: 580,
      actual: 610,
      coverageDay: 2,
      totalDays: 31,
    },
    conventions: {
      usdToSarRate: 3.77,
      minSpendToJudge: 300,
      goodRoas: 3,
      decentRoas: 2,
    },
    ...over,
  };
}

const creative = (id: string, spend: number) => ({
  creativeId: id,
  name: `Creative ${id}`,
  type: "video",
  statusHere: "active",
  statusGeneral: "active",
  stages: ["Awareness"],
  priority: 2,
  angles: ["UGC"],
  launchDate: "2026-08-01",
  product: "Serum",
  inCampaign: {
    spend,
    impressions: 1000,
    clicks: 20,
    conversions: 1,
    revenue: spend * 2,
    ctr: 0.02,
    cvr: 0.05,
    cpa: spend,
    roas: 2,
    lastDate: "2026-10-02",
  },
  daily: [
    {
      date: "2026-10-02",
      spend: spend / 14,
      impressions: 70,
      clicks: 2,
      conversions: 0,
      revenue: 0,
    },
  ],
  elsewhere: { spend: 0, revenue: 0, roas: null, campaigns: 1 },
});

describe("the bundle's shape", () => {
  it("splits the daily window from the weekly history", () => {
    const b = serializeDiagnosis(
      input({
        days: [
          day("2026-08-10"), // before the window → weekly
          day("2026-08-11"),
          day("2026-09-04"), // inside → daily
          day("2026-09-05"),
        ],
      }),
    );
    expect(b.series.daily.map((d) => d.date)).toEqual(["2026-09-04", "2026-09-05"]);
    expect(b.series.weeklyBefore).toHaveLength(1);
    expect(b.series.weeklyBefore[0]!.days).toBe(2);
    expect(b.series.weeklyBefore[0]!.spend).toBe(200);
  });

  it("recomputes weekly ratios from the week's SUMS, never from daily ratios", () => {
    // A week of two very different days: averaging their CTRs would give
    // 0.105; the weighted answer is 0.0191.
    const { weeks } = weeklyRollup([
      day("2026-09-06", { clicks: 10, impressions: 100 }), // 10%
      day("2026-09-07", { clicks: 100, impressions: 10_000 }), // 1%
    ]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.ctr).toBeCloseTo(110 / 10_100, 6);
    expect(weeks[0]!.ctr).not.toBeCloseTo(0.055, 3);
  });

  it("keeps the MOST RECENT weeks at the cap, and says it truncated", () => {
    const many: DiagnosisDayRow[] = [];
    for (let w = 0; w < MAX_DIAGNOSIS_WEEKS + 6; w++) {
      const d = new Date(Date.UTC(2025, 0, 5 + w * 7)).toISOString().slice(0, 10);
      many.push(day(d));
    }
    const { weeks, truncated } = weeklyRollup(many);
    expect(truncated).toBe(true);
    expect(weeks).toHaveLength(MAX_DIAGNOSIS_WEEKS);
    // The newest week survived; the oldest did not.
    expect(weeks.at(-1)!.weekStart).toBe(many.at(-1)!.date);
    expect(weeks[0]!.weekStart > many[0]!.date).toBe(true);
  });

  it("caps creatives by IN-CAMPAIGN spend and notes the cap", () => {
    const rows = Array.from({ length: MAX_DIAGNOSIS_CREATIVES + 5 }, (_, i) =>
      creative(`c${i}`, i * 10),
    );
    const b = serializeDiagnosis(input({ creatives: rows }));
    expect(b.creatives.rows).toHaveLength(MAX_DIAGNOSIS_CREATIVES);
    expect(b.creatives.total).toBe(rows.length);
    expect(b.creatives.truncated).toBe(true);
    expect(b.creatives.note).toContain(String(MAX_DIAGNOSIS_CREATIVES));
    // Ranked by spend, biggest first — the cap drops the smallest.
    expect(b.creatives.rows[0]!.inCampaign.spend).toBe((rows.length - 1) * 10);
    expect(b.creatives.rows.at(-1)!.inCampaign.spend).toBeGreaterThan(
      rows[0]!.inCampaign.spend,
    );
  });

  it("gives each creative's dailies as SUMS ONLY — no derivable ratios", () => {
    const b = serializeDiagnosis(input({ creatives: [creative("a", 140)] }));
    const row = b.creatives.rows[0]!.daily[0]!;
    expect(Object.keys(row).sort()).toEqual([
      "clicks",
      "conversions",
      "date",
      "impressions",
      "revenue",
      "spend",
    ]);
    // A reader recomputes ratios from these; shipping per-day ctr/cvr/roas
    // would be payload the conventions forbid using as-is.
    expect(row).not.toHaveProperty("ctr");
    expect(row).not.toHaveProperty("cvr");
    expect(row).not.toHaveProperty("roas");
  });

  it("says nothing about a cap when nothing was capped", () => {
    const b = serializeDiagnosis(input({ creatives: [creative("a", 10)] }));
    expect(b.creatives.truncated).toBe(false);
    expect(b.creatives.note).toBeUndefined();
  });

  it("carries the campaign's share of its platform's spend", () => {
    const b = serializeDiagnosis(
      input({ days: [day("2026-09-04", { spend: 2_000 })] }),
    );
    expect(b.benchmarks.campaignShareOfPlatformSpend).toBeCloseTo(0.1, 6);
  });

  it("echoes meta a transcript can stand on", () => {
    const b = serializeDiagnosis(input());
    expect(b.meta.brand).toBe("Urjwan");
    expect(b.meta.name).toBe("Ramadan ➤ Broad (IG)");
    expect(b.meta.window).toEqual({ from: "2026-09-04", to: "2026-10-03", days: 30 });
    expect(b.meta.excludedRecords).toBe("hidden");
    expect(b.meta.coverage).toEqual({ instagram: "2026-10-02", tiktok: null });
    expect(b.budget?.expectedAtCoverage).toBe(580);
  });
});

describe("NULL is not zero", () => {
  it("nulls the metrics the campaign's platform cannot report", () => {
    const row = {
      landingPageViews: 0,
      addToCart: 0,
      addPayment: 0,
      videoViews2s: 0,
      clicks: 20,
      spend: 10,
    };
    const google = nullUnavailable(row, "google");
    expect(google.landingPageViews).toBeNull();
    expect(google.addToCart).toBeNull();
    expect(google.videoViews2s).toBeNull();
    // What google DOES report is untouched.
    expect(google.clicks).toBe(20);
    expect(google.spend).toBe(10);
    // …and a platform that reports them keeps its zeros, which are real.
    expect(nullUnavailable(row, "instagram").landingPageViews).toBe(0);
  });

  it("does it through the whole daily series of a google campaign", () => {
    const b = serializeDiagnosis(
      input({
        campaign: { ...input().campaign, platform: "google", platforms: ["google"] },
        days: [day("2026-09-04", { landingPageViews: 0, videoViews2s: 0 })],
      }),
    );
    expect(b.series.daily[0]!.landingPageViews).toBeNull();
    expect(b.series.daily[0]!.videoViews2s).toBeNull();
    expect(b.series.daily[0]!.clicks).toBe(200);
  });

  it("marks a no-data day as a GAP, not a zero", () => {
    const b = serializeDiagnosis(
      input({ days: [day("2026-09-04", { records: 0, spend: 0, impressions: 0 })] }),
    );
    expect(b.series.daily[0]!.records).toBe(0);
    expect(b.series.daily[0]!.spend).toBe(0);
    // A ratio with no denominator is null, never 0.
    expect(b.series.daily[0]!.ctr).toBeNull();
    expect(b.series.daily[0]!.roas).toBeNull();
  });
});

describe("the conventions block", () => {
  const text = () => serializeDiagnosis(input()).conventions;

  it("carries the coverage dates and what they mean", () => {
    expect(text()).toContain("instagram: 2026-10-02");
    expect(text()).toContain("tiktok: no data");
    expect(text()).toMatch(/missing data rather than zero/);
    expect(text()).toMatch(/THROUGH the coverage day/);
  });

  it("carries the brand's min-spend judging threshold and its ROAS bands", () => {
    expect(text()).toContain("$300");
    expect(text()).toContain("too small to judge");
    expect(text()).toContain("3× (good)");
  });

  it("states the ROAS basis this brand actually uses", () => {
    expect(text()).toMatch(/RAW spend including Awareness/);
    expect(text()).toMatch(/AFTER discounts/);
    expect(text()).toContain("3.77");
  });

  it("forbids averaging ratios", () => {
    expect(text()).toMatch(/never the mean of per-row ratios/);
    expect(text()).toMatch(/recompute from the sums/);
  });

  it("names reach and frequency as ABSENT and asks for them", () => {
    expect(text()).toMatch(/REACH AND FREQUENCY ARE NOT TRACKED/);
    expect(text()).toMatch(/ASK THE USER/);
  });

  it("warns that store attribution is platform-level, not campaign-level", () => {
    expect(text()).toMatch(/PLATFORM-level, not campaign-level/);
    expect(text()).toMatch(/Do not attribute store revenue to this campaign/);
  });

  it("names the unavailable metric set for a google campaign only", () => {
    const google = diagnosisConventions({
      rate: 3.77,
      minSpendToJudge: 300,
      goodRoas: 3,
      decentRoas: 2,
      platform: "google",
      coverage: { google: "2026-10-01" },
      excludedRecords: "hidden",
    });
    expect(google).toContain("does not report: landingPageViews");
    expect(google).toContain("do not infer a funnel from them");
    expect(text()).not.toContain("does not report:");
  });

  it("echoes whether excluded records were counted", () => {
    expect(text()).toContain("excluded-from-aggregates are hidden");
    const included = serializeDiagnosis(
      input({ excludedRecords: "included" }),
    ).conventions;
    expect(included).toContain("excluded-from-aggregates are included");
  });
});

describe("the instructions", () => {
  const t = DIAGNOSIS_INSTRUCTIONS;

  it("asks where it matters instead of blocking the whole report", () => {
    // Tuned 2026-10 from the first real transcript: the old wording stopped
    // everything on one missing number, which left the reader with nothing.
    expect(t).toMatch(/THE INTERVIEW RULE — ASK WHERE IT MATTERS, DO NOT BLOCK THE REPORT/);
    expect(t.indexOf("INTERVIEW RULE")).toBeLessThan(t.indexOf("EVIDENCE RULE"));
    expect(t).toMatch(/DELIVER EVERY SECTION THE BUNDLE CAN ALREADY ANSWER/);
    expect(t).toMatch(/ask for it AT THAT POINT/);
    expect(t).toMatch(/PENDING YOUR DATA/);
    expect(t).toMatch(/never as an upfront questionnaire/);
    expect(t).not.toMatch(/WAIT for the reply/);
  });

  it("makes the model restate the artifact promise in its own chat messages", () => {
    // Turn-distance decay: by the time the report is written, rule 4 sits two
    // or three turns back behind a ~26K-token bundle, and in practice the
    // report came back as chat text. Appending this sentence to the model's
    // OWN question puts the commitment one turn from the deliverable.
    // Verbatim, so a paraphrase trips THIS test by name.
    expect(t).toContain(
      "When you answer, I'll update the report as an artifact — never as chat text.",
    );
    expect(t).toMatch(/must END with this exact sentence/);
    expect(t).toMatch(/do not drop or paraphrase it/);
    // It belongs to the interview rule — the message that asks is the message
    // that promises.
    expect(t.indexOf("must END with this exact sentence")).toBeLessThan(
      t.indexOf("2. THE EVIDENCE RULE"),
    );
  });

  it("still needs reach and frequency before any fatigue call", () => {
    expect(t).toMatch(/REACH and FREQUENCY/);
    expect(t).toMatch(/fatigue or saturation call/);
    expect(t).toMatch(/COMPLETE the pending section and reissue/);
  });

  it("keeps the standard while changing the scope of the wait", () => {
    expect(t).toMatch(/A right diagnosis still outranks a fast one/);
    expect(t).toMatch(/SCOPE of the wait, not the standard/);
    // The escape hatch, and its price.
    expect(t).toMatch(/If they decline/);
    expect(t).toMatch(/MARK every conclusion that depends on the gap/);
  });

  it("holds every claim to a number in the bundle", () => {
    expect(t).toMatch(/Never invent a figure/);
    expect(t).toMatch(/compare to the BENCHMARKS block/);
    expect(t).toMatch(/too small to judge/);
    expect(t).toMatch(/do not treat null as zero/);
  });

  it("pins the report's SECTION ORDER", () => {
    const order = [
      "VERDICT",
      "DO THIS",
      "CREATIVE CARDS",
      "FUNNEL VS BENCHMARK",
      "BUDGET CONTEXT",
      "FINE PRINT",
    ];
    let at = -1;
    for (const section of order) {
      const next = t.indexOf(section);
      expect(next, `${section} missing from the instructions`).toBeGreaterThan(at);
      at = next;
    }
  });

  it("makes the artifact mechanical and non-optional", () => {
    // It did not fire in practice when it read as a preference, so the wording
    // is now imperative and names the failure mode it has to prevent.
    expect(t).toMatch(/YOUR FINAL REPORT MUST BE CREATED AS AN ARTIFACT/);
    expect(t).toMatch(/ONE self-contained HTML document/);
    expect(t).toMatch(/using your artifact capability|made with your artifact capability/);
    expect(t).toMatch(/NEVER deliver the report as chat text/);
    expect(t).toMatch(/NEVER as markdown tables/);
    expect(t).toMatch(/AT MOST ONE SENTENCE pointing to the artifact/);
    expect(t).toMatch(/UPDATE THE ARTIFACT — or issue a v2 artifact/);
    expect(t).toMatch(/rather than answering in chat tables/);
    // Every VERSION, not just the first one — the reissue is where it slipped.
    expect(t).toMatch(/THIS RULE APPLIES TO EVERY VERSION/);
    expect(t).toMatch(/every reissue after the user supplies data/);
    expect(t).toMatch(/Distance from this instruction is not an excuse/);
  });

  it("keeps the layout contract, including the pending marker", () => {
    expect(t).toMatch(/severity-toned verdict banner/);
    expect(t).toMatch(/responsive grid of creative cards/);
    expect(t).toMatch(/simple CSS bars for the funnel/);
    expect(t).toMatch(/light and dark/);
    expect(t).toMatch(/no network, no build step/);
    expect(t).toMatch(/PENDING YOUR DATA" in place/);
    expect(t).toMatch(/never silently omitted/);
    expect(t).toMatch(/The artifact IS the deliverable/);
  });

  it("names the role and the language", () => {
    expect(t).toMatch(/senior performance-marketing analyst/);
    expect(t).toMatch(/LANGUAGE: write the report in English/);
  });

  it("ships inside every bundle", () => {
    expect(serializeDiagnosis(input()).instructions).toBe(t);
  });
});

describe("the caps are declared, not magic", () => {
  it("exports them so the assembler and the tests agree", () => {
    expect(MAX_DIAGNOSIS_CREATIVES).toBe(20);
    expect(MAX_DIAGNOSIS_WEEKS).toBe(26);
    expect(CREATIVE_DAILY_DAYS).toBe(14);
  });
});
