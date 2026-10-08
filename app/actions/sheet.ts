"use server";

import { requireAuth } from "@/lib/auth";
import { MAX_FILE_BYTES, parseFile } from "@/csv/parse";

/**
 * Read a spreadsheet into rows of strings — the ONE conversion layer
 * (`csv/parse.ts`), reachable from a client surface that parses its own file.
 *
 * Why a server action: the ads, store and bulk-creative uploads already POST
 * their file and parse it on the server, but the Budget plan sheet builds its
 * whole preview in the browser from papaparse. Pulling SheetJS into that page
 * would put a workbook reader in the client bundle for a feature most visits
 * never use — so the FILE comes here instead and goes home as rows. The CSV
 * path is untouched and still parses in the browser.
 *
 * READ-ONLY: it validates the caller is signed in, converts bytes, and writes
 * nothing. There is no account scope to apply — the bytes are the caller's own
 * upload, and nothing is stored.
 */
export interface SheetRowsResult {
  ok: boolean;
  /** Header row first, exactly as the CSV path hands it to the same parser. */
  rows?: string[][];
  /** Neutral notices — today: "this workbook had several sheets". */
  notices?: string[];
  error?: string;
}

export async function readSheetRows(form: unknown): Promise<SheetRowsResult> {
  try {
    await requireAuth();
    if (!(form instanceof FormData)) return { ok: false, error: "No file received." };
    const file = form.get("file");
    if (!(file instanceof File)) return { ok: false, error: "No file received." };
    if (file.size > MAX_FILE_BYTES) {
      return { ok: false, error: "File exceeds the 10 MB upload limit." };
    }
    const content = await file.arrayBuffer();
    const parsed = parseFile({ content, fileName: file.name, byteLength: content.byteLength });
    if (!parsed.ok) return { ok: false, error: parsed.error.message };
    return {
      ok: true,
      rows: [parsed.header, ...parsed.rows],
      notices: parsed.warnings.map((w) => w.message),
    };
  } catch {
    return { ok: false, error: "That file could not be read." };
  }
}
