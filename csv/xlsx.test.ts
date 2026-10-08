import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { numberToPlainString, parseFile, xlsxFailure } from "@/csv/parse";
import { runPipeline } from "@/csv/pipeline";
import { runStorePipeline } from "@/store/pipeline";
import { parsePlanCsvMatrix, planCsvHeader, planCsvRows } from "@/lib/budget-plan-csv";
import type { StoreField } from "@/store/fields";

/**
 * Workbooks are built HERE with SheetJS rather than committed as binary
 * fixtures: a checked-in .xlsx is unreviewable in a diff, and a sheet written
 * in-test states exactly which Excel feature each case exercises.
 */
function book(
  sheets: Record<string, unknown[][]>,
  opts: { date1904?: boolean } = {},
): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  if (opts.date1904) wb.Workbook = { WBProps: { date1904: true } };
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(out);
}

const xlsx = (bytes: Uint8Array, fileName = "upload.xlsx") =>
  parseFile({ content: bytes, fileName, byteLength: bytes.byteLength });

describe("xlsx → rows (the one conversion layer)", () => {
  it("reads a sheet as header + body rows of strings", () => {
    const res = xlsx(book({ Sheet1: [["Ad name", "Day"], ["URJ_VID_001", "2026-05-01"]] }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.header).toEqual(["Ad name", "Day"]);
    expect(res.rows).toEqual([["URJ_VID_001", "2026-05-01"]]);
    expect(res.rowNumbers).toEqual([2]);
    expect(res.warnings).toEqual([]);
  });

  it("serializes a real date cell as an ISO date, not Excel's serial", () => {
    const res = xlsx(book({ S: [["Day"], [new Date(Date.UTC(2026, 9, 8))]] }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows[0]?.[0]).toBe("2026-10-08");
  });

  it("reads the same date from a 1904-system workbook", () => {
    const res = xlsx(book({ S: [["Day"], [new Date(Date.UTC(2026, 9, 8))]] }, { date1904: true }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows[0]?.[0]).toBe("2026-10-08");
  });

  it("takes a formula cell's cached value, not its formula", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["Spend"], [0]]);
    sheet["A2"] = { t: "n", f: "2+3", v: 5 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "S");
    const bytes = new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
    const res = xlsx(bytes);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows[0]?.[0]).toBe("5");
  });

  it("writes empty cells as \"\" and keeps booleans readable", () => {
    const res = xlsx(book({ S: [["A", "B", "C"], ["x", "", true]] }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows[0]).toEqual(["x", "", "TRUE"]);
  });

  it("reads numbers as plain decimals (no exponent, no separators)", () => {
    const res = xlsx(book({ S: [["N"], [1234567.5], [1e21], [0.1]] }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows.map((r) => r[0])).toEqual(["1234567.5", "1000000000000000000000", "0.1"]);
    }
  });

  it("warns (W003) that only the first sheet of a multi-sheet workbook was read", () => {
    const res = xlsx(
      book({
        Summary: [["Ad name", "Day"], ["URJ_VID_001", "2026-05-01"]],
        Daily: [["ignored"], ["also ignored"]],
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warnings.map((w) => w.code)).toEqual(["W003"]);
    expect(res.warnings[0]?.message).toContain("2 sheets");
    expect(res.warnings[0]?.message).toContain("Summary");
    // The first sheet's data is what came through.
    expect(res.rows).toEqual([["URJ_VID_001", "2026-05-01"]]);
  });

  it("routes by magic bytes when the extension lies", () => {
    const bytes = book({ S: [["A"], ["1"]] });
    const res = parseFile({ content: bytes, fileName: "export.txt", byteLength: bytes.byteLength });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.header).toEqual(["A"]);
  });

  it("rejects an empty workbook with E003", () => {
    const res = xlsx(book({ S: [[]] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("E003");
  });
});

describe("unreadable files say which problem it is", () => {
  it("a corrupt workbook gets the Excel message, not an encoding one", () => {
    const junk = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);
    const res = parseFile({ content: junk, fileName: "broken.xlsx", byteLength: junk.byteLength });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("E002");
      expect(res.error.message).toContain("could not be read");
    }
  });

  it("other binary junk is not reported as an encoding problem", () => {
    // PNG signature — NUL bytes, no text encoding would produce it.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
    const res = parseFile({ content: png, fileName: "logo.png", byteLength: png.byteLength });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("E002");
      expect(res.error.message).toContain("doesn't look like a CSV or Excel file");
    }
  });

  it("a password-protected workbook gets its own sentence", () => {
    const msg = xlsxFailure(new Error("File is password-protected")).message;
    expect(msg).toContain("password-protected");
    expect(xlsxFailure(new Error("zip: bad CRC")).message).toContain("corrupt");
  });
});

describe("numberToPlainString", () => {
  it("keeps integers and decimals as typed", () => {
    expect(numberToPlainString(0)).toBe("0");
    expect(numberToPlainString(-12)).toBe("-12");
    expect(numberToPlainString(1234.56)).toBe("1234.56");
  });

  it("never returns exponent notation", () => {
    expect(numberToPlainString(1e21)).toBe("1000000000000000000000");
    expect(numberToPlainString(1e-7)).not.toContain("e");
  });

  it("drops a non-finite number rather than writing \"Infinity\"", () => {
    expect(numberToPlainString(Infinity)).toBe("");
    expect(numberToPlainString(NaN)).toBe("");
  });
});

// ── The three pipelines take a workbook with no change of their own ─────────

const META_HEADER = [
  "Ad name",
  "Campaign name",
  "Ad set name",
  "Day",
  "Amount spent (USD)",
  "Impressions",
  "Link clicks",
  "Results",
  "Purchase value",
  "Landing page views",
  "2-second continuous video plays",
  "Video plays at 25%",
  "Video plays at 50%",
  "Video plays at 75%",
  "Video plays at 100%",
];

describe("the ads pipeline accepts a workbook", () => {
  it("imports the same rows it would from a CSV, and passes the sheet notice through", async () => {
    const bytes = book({
      Export: [
        META_HEADER,
        ["URJ_VID_001", "Spring Launch", "Broad", new Date(Date.UTC(2026, 4, 1)), 10, 100, 5, 0, 0, 0, 0, 0, 0, 0, 0],
      ],
      Notes: [["ignored"], ["x"]],
    });
    const res = await runPipeline({
      content: bytes,
      fileName: "meta.xlsx",
      byteLength: bytes.byteLength,
      platform: "instagram",
      registeredNames: new Set(["URJ_VID_001"]),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.date).toBe("2026-05-01");
    expect(res.rows[0]?.spend).toBe(10);
    expect(res.warnings.map((w) => w.code)).toContain("W003");
  });
});

describe("the store pipeline accepts a workbook", () => {
  const field = (
    key: "order_id" | "order_date" | "total_amount",
    headers: string[],
  ): StoreField => ({
    id: key,
    key,
    label: key,
    type: key === "order_date" ? "date" : key === "total_amount" ? "number" : "text",
    required: true,
    headers,
    sortOrder: 0,
    core: true,
    systemRequired: false,
  });

  it("imports dates and amounts from cells, and maps the sheet notice to S061", () => {
    const bytes = book({
      Orders: [
        ["Order ID", "Order Date", "Total"],
        ["1001", new Date(Date.UTC(2026, 7, 4)), 249.5],
      ],
      Archive: [["ignored"], ["x"]],
    });
    const res = runStorePipeline({
      content: bytes,
      fileName: "orders.xlsx",
      byteLength: bytes.byteLength,
      fields: [
        field("order_id", ["Order ID"]),
        field("order_date", ["Order Date"]),
        field("total_amount", ["Total"]),
      ],
      existingOrderIds: new Set(),
      upsert: false,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]?.orderDate).toBe("2026-08-04");
    expect(res.rows[0]?.totalAmount).toBe("249.50");
    expect(res.warnings.map((w) => w.code)).toContain("S061");
  });
});

describe("the budget plan sheet accepts a workbook", () => {
  it("round-trips the template: download → save as .xlsx → upload", () => {
    // The template's own header and rows, written into a sheet as NUMBERS and
    // day numbers — which is what Excel makes of them the moment someone
    // opens the CSV and saves it as a workbook.
    const month = "2026-05";
    const cells = [
      { day: 1, platform: "instagram" as const, objective: "Activation" as const, plannedSpend: 100 },
      { day: 2, platform: "instagram" as const, objective: "Activation" as const, plannedSpend: 150.25 },
    ];
    const rows = planCsvRows(month, cells, 40);
    const bytes = book({ Plan: [planCsvHeader(), ...rows] });

    const res = xlsx(bytes, "plan.xlsx");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const parsed = parsePlanCsvMatrix(res.header, res.rows, month);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.plan.reserveSpendUsd).toBe(40);
    const day = (d: number) =>
      parsed.plan.days
        .filter((c) => c.day === d && c.platform === "instagram" && c.objective === "Activation")
        .map((c) => c.plannedSpend);
    expect(day(1)).toEqual([100]);
    expect(day(2)).toEqual([150.25]);
    // Every other cell was blank, and blank means no money — not a zero row.
    expect(parsed.plan.days).toHaveLength(2);
  });
});
