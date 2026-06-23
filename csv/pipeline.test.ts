import { describe, it, expect } from "vitest";
import { runPipeline } from "@/csv/pipeline";

const REGISTERED = new Set(["URJ_VID_001", "URJ_VID_002", "URJ_IMG_010"]);

/**
 * Every adapter requires its full column set. The test header mirrors the
 * Instagram/Meta adapter's defaults; rows below must have the same number of
 * values in the same order (use 0 for "nothing to report on this day").
 */
const META_HEADER =
  "Ad name,Campaign name,Ad set name,Day,Amount spent (USD),Impressions,Link clicks,Results,Purchase value,Landing page views,2-second continuous video plays,Video plays at 25%,Video plays at 50%,Video plays at 75%,Video plays at 100%";

const row = (fields: {
  name?: string;
  campaign?: string;
  adset?: string;
  date?: string;
  spend?: string;
  imps?: string;
  clicks?: string;
  conv?: string;
  convVal?: string;
  lpv?: string;
  v2s?: string;
  v25?: string;
  v50?: string;
  v75?: string;
  v100?: string;
}) =>
  [
    fields.name ?? "URJ_VID_001",
    fields.campaign ?? "Spring Launch",
    fields.adset ?? "Broad",
    fields.date ?? "2026-05-01",
    fields.spend ?? "10",
    fields.imps ?? "100",
    fields.clicks ?? "5",
    fields.conv ?? "0",
    fields.convVal ?? "0",
    fields.lpv ?? "0",
    fields.v2s ?? "0",
    fields.v25 ?? "0",
    fields.v50 ?? "0",
    fields.v75 ?? "0",
    fields.v100 ?? "0",
  ].join(",");

async function run(
  csv: string,
  opts: {
    findExistingBatch?: (
      n: string,
      p: string,
      campaign: string,
      d: string,
    ) => Promise<string | null>;
    registeredCampaigns?: Set<string>;
  } = {},
) {
  return runPipeline({
    content: csv,
    platform: "instagram",
    registeredNames: REGISTERED,
    registeredCampaigns: opts.registeredCampaigns,
    findExistingBatch: opts.findExistingBatch,
  });
}

describe("CSV pipeline — Stage 1 (file integrity)", () => {
  it("rejects an empty file with E003", async () => {
    const res = await run("");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.code).toBe("E003");
  });

  it("rejects a file with only a header row as E003", async () => {
    const res = await run(`${META_HEADER}\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.code).toBe("E003");
  });
});

describe("CSV pipeline — Stage 2 (schema)", () => {
  it("rejects a missing required column with E010", async () => {
    // Drop the Impressions column.
    const header =
      "Ad name,Day,Amount spent (USD),Link clicks,Results,Purchase value,3-second video plays,ThruPlays";
    const res = await run(`${header}\nURJ_VID_001,2026-05-01,10,5,0,0,0,0\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.map((e) => e.code)).toContain("E010");
    }
  });

  it("rejects when an optional-looking metric column is missing (all columns required)", async () => {
    // Drop the Purchase value column.
    const header =
      "Ad name,Day,Amount spent (USD),Impressions,Link clicks,Results,3-second video plays,ThruPlays";
    const res = await run(`${header}\nURJ_VID_001,2026-05-01,10,100,5,0,0,0\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain("E010");
  });

  it("matches headers case-insensitively and trims whitespace", async () => {
    const lower = META_HEADER.toLowerCase().replace(/,/g, " , ");
    const res = await run(`${lower}\n${row({})}\n`);
    expect(res.ok).toBe(true);
  });

  it("warns W002 for unknown columns and still accepts good data", async () => {
    const res = await run(
      `${META_HEADER},Custom note\n${row({})},hello\n`,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.warnings.some((w) => w.code === "W002")).toBe(true);
    }
  });

  it("rejects duplicate header columns with E012", async () => {
    const dupHeader =
      "Ad name,Day,Amount spent (USD),Impressions,Impressions,Link clicks,Results,Purchase value,3-second video plays,ThruPlays";
    const res = await run(`${dupHeader}\nURJ_VID_001,2026-05-01,1,1,1,1,0,0,0,0\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.code).toBe("E012");
  });
});

describe("CSV pipeline — Stage 3 (row content)", () => {
  it("rejects unknown creative names with E020", async () => {
    const res = await run(
      `${META_HEADER}\n${row({ name: "URJ_NOT_REGISTERED" })}\n`,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain("E020");
  });

  it("rejects empty creative names with E021", async () => {
    const res = await run(`${META_HEADER}\n${row({ name: "" })}\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain("E021");
  });

  it("rejects invalid dates with E030", async () => {
    const res = await run(`${META_HEADER}\n${row({ date: "31/13/2026" })}\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain("E030");
  });

  it("accepts ISO + DD/MM/YYYY + MM/DD/YYYY date formats (day-first wins on ambiguity)", async () => {
    const res = await run(
      // 28/05/2026 → unambiguous DD/MM/YYYY (day=28 > 12).
      `${META_HEADER}\n${row({ date: "28/05/2026" })}\n${row({
        name: "URJ_VID_002",
        date: "2026-05-02",
      })}\n${row({ name: "URJ_IMG_010", date: "03/05/2026" })}\n`,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows[0]?.date).toBe("2026-05-28");
      expect(res.rows[1]?.date).toBe("2026-05-02");
      // 03/05/2026 — DD/MM/YYYY listed first, so day-first wins.
      expect(res.rows[2]?.date).toBe("2026-05-03");
    }
  });

  it("accepts dash and dot separators", async () => {
    const res = await run(
      `${META_HEADER}\n${row({ date: "28-05-2026" })}\n${row({
        name: "URJ_VID_002",
        date: "28.05.2026",
      })}\n`,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows[0]?.date).toBe("2026-05-28");
      expect(res.rows[1]?.date).toBe("2026-05-28");
    }
  });

  it("rejects far-future dates with E031", async () => {
    const res = await run(`${META_HEADER}\n${row({ date: "2099-01-01" })}\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain("E031");
  });

  it("rejects non-numeric spend with E040", async () => {
    const res = await run(`${META_HEADER}\n${row({ spend: "twelve" })}\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain("E040");
  });

  it("rejects negative spend with E041", async () => {
    const res = await run(`${META_HEADER}\n${row({ spend: "-12.45" })}\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain("E041");
  });

  it("strips commas and currency symbols from numeric fields", async () => {
    const res = await run(
      `${META_HEADER}\n${row({ spend: '"$1,234.56"', imps: "10000" })}\n`,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows[0]?.spend).toBe(1234.56);
  });

  it("treats blank numeric cells as 0 (column required, cell tolerant)", async () => {
    const res = await run(`${META_HEADER}\n${row({ conv: "", v100: "" })}\n`);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows[0]?.conversions).toBe(0);
      expect(res.rows[0]?.videoViews100).toBe(0);
    }
  });
});

describe("CSV pipeline — Stage 4 (intra-file duplicates)", () => {
  it("rejects two rows with the same (creative, campaign, date) — E050", async () => {
    const res = await run(
      `${META_HEADER}\n${row({})}\n${row({ spend: "11" })}\n`,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const e050 = res.errors.find((e) => e.code === "E050");
      expect(e050).toBeDefined();
      expect(e050?.rows).toEqual([2, 3]);
    }
  });

  it("allows the same creative + date across DIFFERENT campaigns", async () => {
    const res = await run(
      `${META_HEADER}\n${row({ campaign: "Spring" })}\n${row({ campaign: "Summer", spend: "11" })}\n`,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows.length).toBe(2);
  });
});

describe("CSV pipeline — Stage 5 (database duplicates)", () => {
  it("rejects E051 when findExistingBatch returns a batch id", async () => {
    const res = await run(`${META_HEADER}\n${row({})}\n`, {
      findExistingBatch: async () => "batch-abc",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const e051 = res.errors.find((e) => e.code === "E051");
      expect(e051).toBeDefined();
      expect(e051?.message).toContain("already imported");
    }
  });

  it("passes the combined campaign name to the existing-batch lookup", async () => {
    let seenCampaign: string | null = null;
    const res = await run(`${META_HEADER}\n${row({ campaign: "Holiday" })}\n`, {
      findExistingBatch: async (_n, _p, campaign) => {
        seenCampaign = campaign;
        return null;
      },
    });
    expect(res.ok).toBe(true);
    expect(seenCampaign).toBe("Holiday ➤ Broad (Instagram)");
  });
});

describe("CSV pipeline — happy path", () => {
  it("returns parsed rows when everything is clean", async () => {
    const res = await run(
      `${META_HEADER}\n${row({ spend: "12.50" })}\n${row({
        name: "URJ_VID_002",
        date: "2026-05-02",
        spend: "99.99",
      })}\n`,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows).toHaveLength(2);
      expect(res.rows[0]?.creativeName).toBe("URJ_VID_001");
      expect(res.rows[0]?.spend).toBe(12.5);
      expect(res.rows[1]?.creativeName).toBe("URJ_VID_002");
    }
  });

  it("skips a subtotal row with empty creative and date", async () => {
    // A real Meta-export grand-total/subtotal row leaves the label columns
    // (Ad name, Campaign, Ad set, Day) blank and only fills the metric totals.
    // metaSkipRow drops it on empty creative + date, so it never reaches the
    // required-field checks. (15 columns: 4 blank labels + 11 metrics.)
    const res = await run(
      `${META_HEADER}\n${row({})}\n,,,,500,5000,250,0,0,0,0,0,0,0,0\n`,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows).toHaveLength(1);
  });
});

describe("CSV pipeline — campaign registration (E061)", () => {
  it("accepts a row whose campaign is registered", async () => {
    const res = await run(`${META_HEADER}\n${row({})}\n`, {
      registeredCampaigns: new Set(["Spring Launch ➤ Broad (Instagram)"]),
    });
    expect(res.ok).toBe(true);
  });

  it("rejects a row whose campaign is NOT registered — E061", async () => {
    const res = await run(`${META_HEADER}\n${row({})}\n`, {
      registeredCampaigns: new Set(["Some Other Campaign"]),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.code === "E061")).toBe(true);
  });

  it("skips the check entirely when registeredCampaigns is omitted", async () => {
    const res = await run(`${META_HEADER}\n${row({})}\n`);
    expect(res.ok).toBe(true);
  });

  it("rejects everything when the registry is EMPTY (not a silent accept)", async () => {
    const res = await run(`${META_HEADER}\n${row({})}\n`, {
      registeredCampaigns: new Set(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.code === "E061")).toBe(true);
  });
});

