import { describe, expect, it } from "vitest";
import { toCsvColumns, type DataColumn } from "@/components/ui/data-table";
import { rowsToCsv } from "@/lib/csv-export";

/**
 * What a table exports. One CSV column per table column — except a column
 * that declares `csvColumns`, which exports as those instead (2026-11:
 * Funnel's platform table nests campaigns under a platform in ONE on-screen
 * column, and its file used to put campaign names under "Platform").
 */
type Row = { kind: "platform" | "campaign"; platform: string; name?: string; spend: number };

const render = () => null;

describe("toCsvColumns", () => {
  const rows: Row[] = [
    { kind: "platform", platform: "Instagram", spend: 30 },
    { kind: "campaign", platform: "Instagram", name: "Summer", spend: 30 },
  ];

  it("exports one column per table column: csv, else sortValue, else empty", () => {
    const cols: DataColumn<Row>[] = [
      { key: "a", label: "Platform", render, csv: (r) => r.platform },
      { key: "b", label: "Spend", render, sortValue: (r) => r.spend },
      { key: "c", label: "Nothing", render },
    ];
    const out = toCsvColumns(cols);
    expect(out.map((c) => c.label)).toEqual(["Platform", "Spend", "Nothing"]);
    expect(out.map((c) => c.value(rows[0]!, 0))).toEqual(["Instagram", 30, null]);
  });

  it("a column with csvColumns exports as those, in place, and wins over csv", () => {
    const cols: DataColumn<Row>[] = [
      {
        key: "platform",
        label: "Platform",
        render,
        csv: () => "never used",
        csvColumns: [
          { label: "Platform", value: (r) => r.platform },
          { label: "Campaign", value: (r) => (r.kind === "campaign" ? (r.name ?? "") : "") },
        ],
      },
      { key: "spend", label: "Spend", render, csv: (r) => r.spend },
    ];
    const out = toCsvColumns(cols);
    expect(out.map((c) => c.label)).toEqual(["Platform", "Campaign", "Spend"]);
    // Keys stay unique, so two halves of one column never collide.
    expect(new Set(out.map((c) => c.key)).size).toBe(3);

    const lines = rowsToCsv(rows, out).replace("\uFEFF", "").trim().split("\n");
    expect(lines).toEqual(["Platform,Campaign,Spend", "Instagram,,30", "Instagram,Summer,30"]);
  });
});
