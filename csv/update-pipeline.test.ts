import { describe, it, expect } from "vitest";
import { runUpdatePipeline } from "@/csv/update-pipeline";

const REGISTERED = new Set(["URJ_VID_001", "URJ_VID_002", "URJ_IMG_010"]);

// Bulk-update files carry ONLY identity columns + the value columns to change.
const IDENTITY = "Ad name,Campaign name,Ad set name,Day";

function run(csv: string) {
  return runUpdatePipeline({
    content: csv,
    platform: "instagram",
    registeredNames: REGISTERED,
  });
}

const codes = (r: ReturnType<typeof run>) =>
  r.ok ? [] : r.errors.map((e) => e.code);

describe("update pipeline — schema", () => {
  it("requires every identity column (missing Day → E010)", () => {
    const res = run("Ad name,Campaign name,Ad set name,Amount spent (USD)\nURJ_VID_001,C,A,10");
    expect(res.ok).toBe(false);
    expect(codes(res)).toContain("E010");
  });

  it("requires at least one value column (identity only → E061)", () => {
    const res = run(`${IDENTITY}\nURJ_VID_001,C,A,2026-05-01`);
    expect(res.ok).toBe(false);
    expect(codes(res)).toContain("E061");
  });
});

describe("update pipeline — happy path", () => {
  it("accepts identity + a single value column and only updates that column", () => {
    const res = run(`${IDENTITY},Amount spent (USD)\nURJ_VID_001,Spring Launch,Broad,2026-05-01,42.5`);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.updateFields).toEqual(["spend"]);
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]!.updates).toEqual({ spend: 42.5 });
    // campaign ➤ adset + IG platform suffix
    expect(res.candidates[0]!.campaignName).toBe("Spring Launch ➤ Broad (Instagram)");
    expect(res.candidates[0]!.date).toBe("2026-05-01");
  });

  it("floors integer columns and keeps spend fractional", () => {
    const res = run(`${IDENTITY},Amount spent (USD),Impressions\nURJ_VID_001,C,A,2026-05-01,9.99,123.7`);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.candidates[0]!.updates).toEqual({ spend: 9.99, impressions: 123 });
  });
});

describe("update pipeline — value validation", () => {
  it("rejects a blank cell in an included value column (E062), never silently 0", () => {
    const res = run(`${IDENTITY},Amount spent (USD)\nURJ_VID_001,C,A,2026-05-01,`);
    expect(res.ok).toBe(false);
    expect(codes(res)).toContain("E062");
  });

  it("rejects non-numeric (E040) and negative (E041) values", () => {
    const bad = run(`${IDENTITY},Amount spent (USD)\nURJ_VID_001,C,A,2026-05-01,abc`);
    expect(codes(bad)).toContain("E040");
    const neg = run(`${IDENTITY},Impressions\nURJ_VID_001,C,A,2026-05-01,-5`);
    expect(codes(neg)).toContain("E041");
  });
});

describe("update pipeline — identity validation", () => {
  it("rejects an unregistered creative (E020)", () => {
    const res = run(`${IDENTITY},Amount spent (USD)\nNOPE,C,A,2026-05-01,10`);
    expect(res.ok).toBe(false);
    expect(codes(res)).toContain("E020");
  });

  it("rejects an invalid date (E030)", () => {
    const res = run(`${IDENTITY},Amount spent (USD)\nURJ_VID_001,C,A,not-a-date,10`);
    expect(res.ok).toBe(false);
    expect(codes(res)).toContain("E030");
  });

  it("rejects intra-file duplicates on the identity (E050)", () => {
    const res = run(
      `${IDENTITY},Amount spent (USD)\nURJ_VID_001,C,A,2026-05-01,10\nURJ_VID_001,C,A,2026-05-01,20`,
    );
    expect(res.ok).toBe(false);
    expect(codes(res)).toContain("E050");
  });

  it("allows the same creative/date across different campaigns", () => {
    const res = run(
      `${IDENTITY},Amount spent (USD)\nURJ_VID_001,C1,A,2026-05-01,10\nURJ_VID_001,C2,A,2026-05-01,20`,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.candidates).toHaveLength(2);
  });
});
