import { describe, expect, it } from "vitest";
import {
  affectedRowCount,
  groupReport,
  problemHeadline,
  rowsPhrase,
  type ReportEntry,
} from "./validation-report";

const e020 = (row: number, value: string): ReportEntry => ({
  code: "E020",
  severity: "ERROR",
  message: `Row ${row}: creative \`'${value}'\` is not registered in the library.`,
  row,
  value,
});

describe("problemHeadline", () => {
  it("drops the row prefix and capitalises", () => {
    expect(problemHeadline("Row 12: creative name is empty.")).toBe("Creative name is empty.");
    expect(problemHeadline("Rows 3, 7: duplicate row.")).toBe("Duplicate row.");
    expect(problemHeadline("The file is empty.")).toBe("The file is empty.");
  });
});

describe("groupReport", () => {
  it("collapses per-row entries into one group per (code, value)", () => {
    const entries = [e020(3, "Hook 07"), e020(7, "Hook 07"), e020(4, "Hook 08"), e020(12, "Hook 07")];
    const groups = groupReport(entries);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.value).toBe("Hook 07");
    expect(groups[0]!.rows).toEqual([3, 7, 12]);
    expect(groups[0]!.entries).toHaveLength(3);
    expect(groups[0]!.headline).toBe("Creative `'Hook 07'` is not registered in the library.");
    expect(groups[1]!.rows).toEqual([4]);
  });

  it("groups value-less entries by their headline", () => {
    const entries: ReportEntry[] = [
      { code: "E030", severity: "ERROR", message: "Row 2: date is missing.", row: 2 },
      { code: "E030", severity: "ERROR", message: "Row 5: date is missing.", row: 5 },
      { code: "E030", severity: "ERROR", message: "Row 6: date is not a date.", row: 6 },
    ];
    const groups = groupReport(entries);
    expect(groups.map((g) => g.rows)).toEqual([[2, 5], [6]]);
  });

  it("puts fatals and errors before warnings, keeping pipeline order", () => {
    const entries: ReportEntry[] = [
      { code: "W004", severity: "WARNING", message: "Conversions were rounded." },
      e020(9, "B"),
      { code: "E001", severity: "FATAL", message: "File too large." },
      e020(2, "A"),
    ];
    expect(groupReport(entries).map((g) => g.code + (g.value ?? ""))).toEqual([
      "E001",
      "E020B",
      "E020A",
      "W004",
    ]);
  });

  it("merges an entry's `rows` with `row` and de-duplicates", () => {
    const entries: ReportEntry[] = [
      { code: "E050", severity: "ERROR", message: "Rows 4, 9: duplicate.", rows: [9, 4], value: "x" },
      { code: "E050", severity: "ERROR", message: "Row 4: duplicate.", row: 4, value: "x" },
    ];
    expect(groupReport(entries)[0]!.rows).toEqual([4, 9]);
    expect(affectedRowCount(entries)).toBe(2);
  });
});

describe("rowsPhrase", () => {
  it("names one row, a few, and many", () => {
    expect(rowsPhrase([])).toBe("");
    expect(rowsPhrase([3])).toBe("row 3");
    expect(rowsPhrase([3, 7, 12])).toBe("3 rows (3, 7, 12)");
    expect(rowsPhrase([3, 7, 12, 15, 20])).toBe("5 rows (3, 7, 12 … +2)");
  });
});
