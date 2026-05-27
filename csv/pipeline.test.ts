import { describe, it, expect } from "vitest";
import { runPipeline } from "@/csv/pipeline";

const REGISTERED = new Set(["URJ_VID_001", "URJ_VID_002", "URJ_IMG_010"]);

const META_HEADER = "Ad name,Day,Amount spent (USD),Impressions,Link clicks";

async function run(csv: string, opts: { findExistingBatch?: (n: string, p: string, d: string) => Promise<string | null> } = {}) {
  return runPipeline({
    content: csv,
    platform: "meta",
    registeredNames: REGISTERED,
    findExistingBatch: opts.findExistingBatch,
  });
}

describe("CSV pipeline — Stage 1 (file integrity)", () => {
  it("rejects an empty file with E003", async () => {
    const res = await run("");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]?.code).toBe("E003");
    }
  });

  it("rejects a file with only a header row as E003", async () => {
    const res = await run(`${META_HEADER}\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.code).toBe("E003");
  });
});

describe("CSV pipeline — Stage 2 (schema)", () => {
  it("rejects a missing required column with E010", async () => {
    const res = await run(`Ad name,Day,Impressions,Link clicks\nURJ_VID_001,2026-05-01,1000,50\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const codes = res.errors.map((e) => e.code);
      expect(codes).toContain("E010");
    }
  });

  it("matches headers case-insensitively and trims whitespace", async () => {
    const res = await run(
      `ad name , DAY ,amount spent (USD), impressions ,link clicks\nURJ_VID_001,2026-05-01,123.45,1000,50\n`,
    );
    expect(res.ok).toBe(true);
  });

  it("warns W002 for unknown columns and still accepts good data", async () => {
    const res = await run(
      `${META_HEADER},Custom note\nURJ_VID_001,2026-05-01,123.45,1000,50,hello\n`,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.warnings.some((w) => w.code === "W002")).toBe(true);
    }
  });

  it("rejects duplicate header columns with E012", async () => {
    const res = await run(`Ad name,Day,Amount spent (USD),Impressions,Impressions,Link clicks\nURJ_VID_001,2026-05-01,1,1,1,1\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.code).toBe("E012");
  });
});

describe("CSV pipeline — Stage 3 (row content)", () => {
  it("rejects unknown creative names with E020", async () => {
    const res = await run(`${META_HEADER}\nURJ_NOT_REGISTERED,2026-05-01,10,100,5\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.map((e) => e.code)).toContain("E020");
    }
  });

  it("rejects empty creative names with E021", async () => {
    const res = await run(`${META_HEADER}\n,2026-05-01,10,100,5\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain("E021");
  });

  it("rejects invalid dates with E030", async () => {
    const res = await run(`${META_HEADER}\nURJ_VID_001,31/13/2026,10,100,5\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain("E030");
  });

  it("accepts ISO + MM/DD/YYYY date formats", async () => {
    const res = await run(
      `${META_HEADER}\nURJ_VID_001,05/01/2026,10,100,5\nURJ_VID_002,2026-05-02,12.34,200,8\n`,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows[0]?.date).toBe("2026-05-01");
      expect(res.rows[1]?.date).toBe("2026-05-02");
    }
  });

  it("rejects far-future dates with E031", async () => {
    const res = await run(`${META_HEADER}\nURJ_VID_001,2099-01-01,10,100,5\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain("E031");
  });

  it("rejects non-numeric spend with E040", async () => {
    const res = await run(`${META_HEADER}\nURJ_VID_001,2026-05-01,twelve,100,5\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain("E040");
  });

  it("rejects negative spend with E041", async () => {
    const res = await run(`${META_HEADER}\nURJ_VID_001,2026-05-01,-12.45,100,5\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain("E041");
  });

  it("strips commas and currency symbols from numeric fields", async () => {
    const res = await run(`${META_HEADER}\nURJ_VID_001,2026-05-01,"$1,234.56",10000,50\n`);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows[0]?.spend).toBe(1234.56);
  });
});

describe("CSV pipeline — Stage 4 (intra-file duplicates)", () => {
  it("reports E050 when the same (creative, date) appears twice", async () => {
    const res = await run(
      `${META_HEADER}\nURJ_VID_001,2026-05-01,10,100,5\nURJ_VID_001,2026-05-01,11,110,6\n`,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const e050 = res.errors.find((e) => e.code === "E050");
      expect(e050).toBeDefined();
      expect(e050?.rows).toEqual([2, 3]);
    }
  });
});

describe("CSV pipeline — Stage 5 (DB duplicates)", () => {
  it("reports E051 when findExistingBatch returns a batch id", async () => {
    const res = await run(`${META_HEADER}\nURJ_VID_001,2026-05-01,10,100,5\n`, {
      findExistingBatch: async () => "batch-abc",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const e051 = res.errors.find((e) => e.code === "E051");
      expect(e051).toBeDefined();
      expect(e051?.message).toContain("batch-abc");
    }
  });

  it("does not double-report when an intra-file dupe already covers the row", async () => {
    const res = await run(
      `${META_HEADER}\nURJ_VID_001,2026-05-01,10,100,5\nURJ_VID_001,2026-05-01,11,110,6\n`,
      { findExistingBatch: async () => "batch-xyz" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const codes = res.errors.map((e) => e.code);
      expect(codes).toContain("E050");
      // E051 may or may not appear; if it does, we just don't want it on the
      // duplicated rows. The simpler invariant: total error count <= 1 for
      // this specific tuple.
      const e051 = res.errors.filter((e) => e.code === "E051");
      expect(e051.length).toBe(0);
    }
  });
});

describe("CSV pipeline — happy path", () => {
  it("returns parsed rows when everything is clean", async () => {
    const res = await run(
      `${META_HEADER}\nURJ_VID_001,2026-05-01,12.50,1000,42\nURJ_VID_002,2026-05-02,99.99,5000,210\n`,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows).toHaveLength(2);
      expect(res.rows[0]?.creativeName).toBe("URJ_VID_001");
      expect(res.rows[0]?.spend).toBe(12.5);
      expect(res.rows[0]?.impressions).toBe(1000);
      expect(res.rows[1]?.creativeName).toBe("URJ_VID_002");
    }
  });

  it("skips a subtotal row with empty creative and date", async () => {
    const res = await run(
      `${META_HEADER}\nURJ_VID_001,2026-05-01,10,100,5\n,,500,5000,250\n`,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows).toHaveLength(1);
  });
});
