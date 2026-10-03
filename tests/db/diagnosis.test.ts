import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant")>("@/lib/tenant");
  return {
    ...actual,
    ACCOUNT_COOKIE: "ccms_account",
    getActiveAccountId: vi.fn(async () => ACCOUNT_A),
    getActiveAccount: vi.fn(),
    listAccounts: vi.fn(async () => []),
    getActiveStatusWindowHours: vi.fn(async () => 24),
  };
});

import { getActiveAccountId } from "@/lib/tenant";
import { campaignDiagnosisInput } from "@/db/queries/diagnosis";
import {
  campaignCreatives,
  campaignRecordsByDay,
} from "@/db/queries/campaign";
import { serializeDiagnosis } from "@/lib/diagnosis";
import { resetAndSeed } from "./fixtures";

// The assembler is the only place the bundle meets real data. What matters
// here: it cannot see another brand, it refuses a name it can't resolve, and
// the numbers it carries are the SAME numbers the pages' own queries produce —
// a bundle that quietly disagrees with the app would be worse than none.

/** The `Account` shape `withBrand` hands a tool — only id/name are read here. */
const brand = (id: string, name: string) => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  statusWindowHours: 24,
});
const BRAND_A = brand(ACCOUNT_A, "Account A");
const CAMPAIGN_A = "Camp One ➤ Broad (IG)";
const CAMPAIGN_B = "Camp B ➤ Broad (IG)";
/** The fixtures live in January 2026; the window is injected, not "now". */
const TODAY = "2026-01-05";
const opts = { windowDays: 30, includeExcluded: false, todayIso: TODAY };

const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => setAccount(ACCOUNT_A));

describe("account scoping — the FK-revalidation discipline", () => {
  it("cannot assemble ANOTHER brand's campaign, even by exact name", async () => {
    // Brand B's campaign exists; from inside brand A it simply isn't there.
    expect(await campaignDiagnosisInput(BRAND_A, CAMPAIGN_B, opts)).toBeNull();
  });

  it("returns null for a name that is not a campaign at all", async () => {
    expect(
      await campaignDiagnosisInput(BRAND_A, "Nothing ➤ Here (IG)", opts),
    ).toBeNull();
  });

  it("assembles it for the brand that DOES own it", async () => {
    setAccount(ACCOUNT_B);
    const input = await campaignDiagnosisInput(
      brand(ACCOUNT_B, "Account B"),
      CAMPAIGN_B,
      opts,
    );
    expect(input).not.toBeNull();
    expect(input!.campaign.name).toBe(CAMPAIGN_B);
    expect(input!.brand.name).toBe("Account B");
  });
});

describe("the bundle reconciles with the queries it was built from", () => {
  it("carries the campaign's own daily rows, window and history alike", async () => {
    const input = await campaignDiagnosisInput(BRAND_A, CAMPAIGN_A, opts);
    const bundle = serializeDiagnosis(input!);

    const days = await campaignRecordsByDay(CAMPAIGN_A, {
      from: input!.window.from,
      to: input!.window.to,
    });
    const sourceSpend = days.reduce((s, d) => s + d.spend, 0);
    const bundleSpend = bundle.series.daily.reduce(
      (s, d) => s + ((d.spend as number) ?? 0),
      0,
    );
    expect(bundleSpend).toBeCloseTo(sourceSpend, 6);
    // The fixture's two in-window days: 100 + 100 (the excluded 1,000 is out).
    expect(bundleSpend).toBeCloseTo(200, 6);
  });

  it("counts excluded records only when asked, and says which it did", async () => {
    const hidden = serializeDiagnosis(
      (await campaignDiagnosisInput(BRAND_A, CAMPAIGN_A, opts))!,
    );
    const included = serializeDiagnosis(
      (await campaignDiagnosisInput(BRAND_A, CAMPAIGN_A, {
        ...opts,
        includeExcluded: true,
      }))!,
    );
    expect(hidden.meta.excludedRecords).toBe("hidden");
    expect(included.meta.excludedRecords).toBe("included");
    const spend = (b: typeof hidden) =>
      b.series.daily.reduce((s, d) => s + ((d.spend as number) ?? 0), 0);
    expect(spend(included) - spend(hidden)).toBeCloseTo(1000, 6);
    expect(included.conventions).toContain("excluded-from-aggregates are included");
  });

  it("carries the campaign's creatives with the same totals the detail page shows", async () => {
    const input = await campaignDiagnosisInput(BRAND_A, CAMPAIGN_A, opts);
    const bundle = serializeDiagnosis(input!);
    const source = await campaignCreatives(CAMPAIGN_A, {
      from: input!.window.from,
      to: input!.window.to,
    });
    expect(bundle.creatives.rows.map((r) => r.name).sort()).toEqual(
      source.map((s) => s.name).sort(),
    );
    const row = bundle.creatives.rows.find((r) => r.name === "A-Creative-1")!;
    const src = source.find((s) => s.name === "A-Creative-1")!;
    expect(row.inCampaign.spend).toBeCloseTo(src.spend, 6);
    expect(row.inCampaign.roas).toBe(src.roas);
    // Library identity rides along (stages/priority/angles/launch).
    expect(row.statusGeneral).toBeTruthy();
    expect(Array.isArray(row.stages)).toBe(true);
  });

  it("gives each creative its CROSS-CAMPAIGN context for the same window", async () => {
    const bundle = serializeDiagnosis(
      (await campaignDiagnosisInput(BRAND_A, CAMPAIGN_A, opts))!,
    );
    const row = bundle.creatives.rows.find((r) => r.name === "A-Creative-1")!;
    // The fixture runs this creative in a second campaign (facebook, $200).
    expect(row.elsewhere.campaigns).toBe(2);
    expect(row.elsewhere.spend).toBeCloseTo(200, 6);
    expect(row.elsewhere.roas).toBeCloseTo(5, 6); // 1,000 revenue ÷ 200 spend
  });

  it("carries the coverage dates, the benchmarks and the budget block", async () => {
    const bundle = serializeDiagnosis(
      (await campaignDiagnosisInput(BRAND_A, CAMPAIGN_A, opts))!,
    );
    // Coverage is the per-platform upload horizon — the pacing anchor.
    expect(bundle.meta.coverage.instagram).toBe("2026-01-03");
    expect(bundle.conventions).toContain("instagram: 2026-01-03");
    // Benchmarks are the brand's SAME-platform numbers for the same window.
    expect(bundle.benchmarks.platform).toBe("instagram");
    expect(bundle.benchmarks.spend).toBeCloseTo(200, 6);
    expect(bundle.benchmarks.campaignShareOfPlatformSpend).toBeCloseTo(1, 6);
    // Budget: the campaign's bucket, at the coverage day (no plan in fixtures).
    expect(bundle.budget?.bucket).toBe("Other"); // "Sales" folds to Other
    expect(bundle.budget?.platform).toBe("instagram");
    expect(bundle.budget?.month).toBe("2026-01");
  });

  it("ships the instructions and the conventions in every bundle", async () => {
    const bundle = serializeDiagnosis(
      (await campaignDiagnosisInput(BRAND_A, CAMPAIGN_A, opts))!,
    );
    expect(bundle.instructions).toMatch(/INTERVIEW RULE/);
    expect(bundle.conventions).toMatch(/REACH AND FREQUENCY ARE NOT TRACKED/);
  });
});
