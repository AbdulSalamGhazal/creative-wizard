import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { CSV_COLUMNS } from "@/components/creative/creative-table";
import { rowsToCsv } from "@/lib/csv-export";
import type { CreativeListRow } from "@/db/queries/creatives";

/**
 * The Library export must carry the creative's FULL data, with tags in ONE
 * comma-separated cell. This runs the REAL production column set against
 * realistic rows (a note with commas, quotes AND a line break; several tags; an
 * unrated priority) and round-trips through a parser, so column order, headers
 * and one-cell semantics are all pinned.
 */

const base: CreativeListRow = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "URJ_VID_001",
  productId: "22222222-2222-2222-2222-222222222222",
  productName: "Argan Oil",
  type: "video",
  status: "active",
  thumbnailUrl: "https://blob.example/thumb.webp",
  launchDate: "2026-04-17",
  tags: ["launch", "ugc", "q4"],
  spend7d: 1234.5,
  spend30d: 6789,
  priority: 2,
  notes: 'Hook A, then B\nCTA: "buy now"',
  sourceLink: "https://example.com/ad?a=1,2",
  createdByName: "Salam Ghazal",
  createdAt: new Date("2026-04-01T09:30:00Z"),
};

function parse(csv: string): string[][] {
  const { data } = Papa.parse<string[]>(csv.replace(/^﻿/, "").trimEnd(), {
    skipEmptyLines: true,
  });
  return data;
}

describe("Library CSV export columns", () => {
  it("exports the full field set, in order", () => {
    const [header] = parse(rowsToCsv([base], CSV_COLUMNS));
    expect(header).toEqual([
      "Creative",
      "Product",
      "Type",
      "Status",
      "Priority",
      "Launch date",
      "Tags",
      "Source link",
      "Notes",
      "7d spend (USD)",
      "30d spend (USD)",
      "Created by",
      "Created at",
      "Thumbnail URL",
    ]);
  });

  it("renders a row with tags as ONE comma-separated cell and a multiline note intact", () => {
    const rows = parse(rowsToCsv([base], CSV_COLUMNS));
    expect(rows).toHaveLength(2); // header + exactly one record
    expect(rows[1]).toEqual([
      "URJ_VID_001",
      "Argan Oil",
      "Video", // display label, not the raw enum
      "Active",
      "2",
      "2026-04-17",
      "launch, ugc, q4", // one cell, comma+space
      "https://example.com/ad?a=1,2",
      'Hook A, then B\nCTA: "buy now"', // newline + comma + quotes survive
      "1234.5",
      "6789",
      "Salam Ghazal",
      "2026-04-01",
      "https://blob.example/thumb.webp",
    ]);
  });

  it("leaves an unrated priority EMPTY (never 0) and nulls blank", () => {
    const unrated: CreativeListRow = {
      ...base,
      priority: null,
      notes: null,
      sourceLink: null,
      thumbnailUrl: null,
      launchDate: null,
      createdByName: null,
      tags: [],
    };
    const rows = parse(rowsToCsv([unrated], CSV_COLUMNS));
    const byCol = Object.fromEntries(
      rows[0]!.map((h, i) => [h, rows[1]![i]]),
    );
    expect(byCol["Priority"]).toBe("");
    expect(byCol["Priority"]).not.toBe("0");
    expect(byCol["Notes"]).toBe("");
    expect(byCol["Source link"]).toBe("");
    expect(byCol["Launch date"]).toBe("");
    expect(byCol["Tags"]).toBe("");
    expect(byCol["Created by"]).toBe("");
    expect(byCol["Thumbnail URL"]).toBe("");
  });
});
