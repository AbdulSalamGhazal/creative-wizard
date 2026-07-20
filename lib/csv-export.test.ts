import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { rowsToCsv, type CsvColumn } from "@/lib/csv-export";

/**
 * `rowsToCsv` is the SHARED exporter behind every "Download CSV" button, so its
 * escaping has to be RFC 4180-correct: any field containing a comma, a double
 * quote, or a newline is wrapped in quotes, and inner quotes are doubled.
 * These cases matter most for the Library export, whose cells carry
 * comma-joined tags, free-text notes (commas + quotes + line breaks), and URLs.
 *
 * Each case asserts the raw bytes AND round-trips through a real parser
 * (papaparse) to prove the value survives as exactly ONE cell.
 */

interface Row {
  a: string;
  b: string;
}

const COLS: CsvColumn<Row>[] = [
  { key: "a", label: "A", value: (r) => r.a },
  { key: "b", label: "B", value: (r) => r.b },
];

/** Parse back, stripping the UTF-8 BOM that rowsToCsv prepends for Excel. */
function parse(csv: string): string[][] {
  const { data } = Papa.parse<string[]>(csv.replace(/^﻿/, "").trimEnd(), {
    skipEmptyLines: true,
  });
  return data;
}

describe("rowsToCsv — RFC 4180 escaping", () => {
  it("quotes a field containing a comma (and it round-trips as one cell)", () => {
    const csv = rowsToCsv([{ a: "a,b", b: "plain" }], COLS);
    expect(csv).toContain('"a,b",plain');
    const rows = parse(csv);
    expect(rows[1]).toEqual(["a,b", "plain"]);
  });

  it("doubles inner quotes and wraps the field", () => {
    const csv = rowsToCsv([{ a: 'He said "hi"', b: "plain" }], COLS);
    expect(csv).toContain('"He said ""hi""",plain');
    const rows = parse(csv);
    expect(rows[1]).toEqual(['He said "hi"', "plain"]);
  });

  it("quotes a field containing a newline, keeping it in ONE cell", () => {
    const csv = rowsToCsv([{ a: "line1\nline2", b: "plain" }], COLS);
    expect(csv).toContain('"line1\nline2",plain');
    const rows = parse(csv);
    // One row, two fields — the embedded newline did NOT split the record.
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["line1\nline2", "plain"]);
  });

  it("handles a field with commas, quotes AND newlines together (a real note)", () => {
    const note = 'Hook A, then B\nCTA: "buy now"';
    const csv = rowsToCsv([{ a: note, b: "after" }], COLS);
    const rows = parse(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual([note, "after"]);
  });

  it("keeps a comma-joined tag list as a single cell", () => {
    const tags = ["launch", "ugc", "q4"];
    const csv = rowsToCsv([{ a: tags.join(", "), b: "after" }], COLS);
    const rows = parse(csv);
    expect(rows[1]).toHaveLength(2); // NOT one column per tag
    expect(rows[1]![0]).toBe("launch, ugc, q4");
    expect(rows[1]![1]).toBe("after");
  });

  it("leaves plain values unquoted and renders null/undefined as empty", () => {
    const cols: CsvColumn<{ v: string | null | undefined }>[] = [
      { key: "v", label: "V", value: (r) => r.v },
    ];
    expect(rowsToCsv([{ v: "plain" }], cols)).toContain("\nplain\n");
    expect(rowsToCsv([{ v: null }], cols)).toContain("V\n\n");
    expect(rowsToCsv([{ v: undefined }], cols)).toContain("V\n\n");
  });

  it("escapes header labels too, and prepends the UTF-8 BOM", () => {
    const csv = rowsToCsv<Row>([], [
      { key: "a", label: "Spend, USD", value: (r) => r.a },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Spend, USD"');
  });
});
