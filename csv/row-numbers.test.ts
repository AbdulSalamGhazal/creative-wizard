import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseFile } from "@/csv/parse";
import { runStorePipeline } from "@/store/pipeline";
import type { StoreField } from "@/store/fields";

/**
 * An error cites the row's place in the FILE (W1-13). Blank lines used to be
 * dropped BEFORE numbering, so every row below a blank line cited a number
 * one too small — the uploader went looking at the wrong row.
 */
describe("row numbers survive blank lines", () => {
  it("CSV: rows keep their file line numbers", () => {
    const res = parseFile({ content: "h1,h2\na,b\n\n  \nc,d\n", fileName: "f.csv" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([["a", "b"], ["c", "d"]]);
    expect(res.rowNumbers).toEqual([2, 5]);
  });

  it("XLSX: rows keep their sheet row numbers", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["h"], ["a"], [], ["c"]]), "S");
    const bytes = new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
    const res = parseFile({ content: bytes, fileName: "f.xlsx", byteLength: bytes.byteLength });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([["a"], ["c"]]);
    expect(res.rowNumbers).toEqual([2, 4]);
  });

  it("a store error below a blank line names the right row", () => {
    const field = (key: "order_id" | "order_date" | "total_amount", header: string): StoreField => ({
      id: key, key, label: key, required: true, headers: [header], sortOrder: 0, core: true,
      systemRequired: false, type: key === "order_date" ? "date" : key === "total_amount" ? "number" : "text",
    });
    const csv = ["Order ID,Order Date,Total", "A1,2026-01-01,100", "", "A2,2026-01-01,abc"].join("\n");
    const res = runStorePipeline({
      content: csv,
      fields: [field("order_id", "Order ID"), field("order_date", "Order Date"), field("total_amount", "Total")],
      existingOrderIds: new Set(),
      upsert: false,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.map((e) => e.message)).toEqual(["Row 4: total_amount `abc` is not a number."]);
  });
});
