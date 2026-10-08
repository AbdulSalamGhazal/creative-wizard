import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

// Pure-unit: the action reads bytes and converts them. Auth is mocked because
// the signed-in check is the only thing it needs from the session, and the DB
// is never touched.
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({ id: "user-1" })),
}));

import { readSheetRows } from "@/app/actions/sheet";
import { MAX_FILE_BYTES } from "@/csv/parse";

function workbook(sheets: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
}

function form(bytes: Uint8Array | string, fileName: string): FormData {
  const fd = new FormData();
  fd.set("file", new File([bytes as BlobPart], fileName));
  return fd;
}

describe("readSheetRows", () => {
  it("returns the header row first, then the body — one array per row", async () => {
    const res = await readSheetRows(
      form(workbook({ Plan: [["Day", "A"], [1, 10], [2, ""]] }), "plan.xlsx"),
    );
    expect(res.ok).toBe(true);
    expect(res.rows).toEqual([
      ["Day", "A"],
      ["1", "10"],
      ["2", ""],
    ]);
    expect(res.notices).toEqual([]);
  });

  it("reports the multi-sheet notice as prose the dialog can show", async () => {
    const res = await readSheetRows(
      form(workbook({ Plan: [["Day"], [1]], Scratch: [["x"], ["y"]] }), "plan.xlsx"),
    );
    expect(res.ok).toBe(true);
    expect(res.notices?.[0]).toContain("only the first one");
  });

  it("parses a CSV through the same layer (the client sends one only on retry)", async () => {
    const res = await readSheetRows(form("Day,A\n1,10\n", "plan.csv"));
    expect(res.ok).toBe(true);
    expect(res.rows).toEqual([
      ["Day", "A"],
      ["1", "10"],
    ]);
  });

  it("refuses anything that is not a file, without throwing", async () => {
    expect(await readSheetRows(undefined)).toEqual({ ok: false, error: "No file received." });
    expect(await readSheetRows(new FormData())).toEqual({
      ok: false,
      error: "No file received.",
    });
  });

  it("stops an over-size file before converting it", async () => {
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    const res = await readSheetRows(form(big, "huge.xlsx"));
    expect(res.ok).toBe(false);
    expect(res.error).toContain("10 MB");
  });

  it("passes the reader's own message through when a file can't be read", async () => {
    const junk = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]);
    const res = await readSheetRows(form(junk, "broken.xlsx"));
    expect(res.ok).toBe(false);
    expect(res.error).toContain("could not be read");
  });
});
