import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

// Only the auth boundary is faked — the parse, the validation and the product
// lookup all run for real.
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: USER, role: "admin" })),
  auth: vi.fn(async () => ({ id: USER, role: "admin" })),
  can: vi.fn(() => true),
}));

import { previewBulkCreatives } from "@/app/actions/creative-bulk";
import { isEmptyMarker } from "@/csv/numeric";
import { NA_STAGE } from "@/lib/funnel-stages";
import { resetAndSeed } from "./fixtures";

/** A one-row-per-line bulk file, as the upload form sends it. */
function fileOf(lines: string[]): FormData {
  const csv = ["name,product,type,stages", ...lines].join("\n");
  const fd = new FormData();
  fd.set("file", new File([csv], "creatives.csv", { type: "text/csv" }));
  return fd;
}

beforeEach(async () => {
  await resetAndSeed();
});

describe("bulk import — the N/A stage", () => {
  it("accepts N/A, case-insensitively, and the bare NA alias", async () => {
    const preview = await previewBulkCreatives(
      fileOf([
        "Bulk-1,Product A,video,N/A",
        "Bulk-2,Product A,video,n/a",
        "Bulk-3,Product A,video,NA",
        "Bulk-4,Product A,video,na",
      ]),
    );
    expect(preview.errorCount).toBe(0);
    expect(preview.rows.map((r) => r.stages)).toEqual([
      [NA_STAGE],
      [NA_STAGE],
      [NA_STAGE],
      [NA_STAGE],
    ]);
  });

  it("still reads the funnel stages, by name or shorthand, N/A sorted last", async () => {
    const preview = await previewBulkCreatives(
      fileOf(["Bulk-1,Product A,video,BOF;Awareness", "Bulk-2,Product A,video,TOF"]),
    );
    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0]?.stages).toEqual(["Awareness", "Retargeting"]);
    expect(preview.rows[1]?.stages).toEqual(["Awareness"]);
  });

  it("errors the ROW that mixes N/A with a funnel stage — nothing is written", async () => {
    const preview = await previewBulkCreatives(
      fileOf(["Bulk-1,Product A,video,N/A;Awareness", "Bulk-2,Product A,video,Awareness"]),
    );
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0]?.ok).toBe(false);
    expect(preview.rows[0]?.errors).toContain(
      `"${NA_STAGE}" can't be combined with a funnel stage.`,
    );
    // The other row is untouched, and the file as a whole can't commit.
    expect(preview.rows[1]?.ok).toBe(true);
    expect(preview.allValid).toBe(false);
  });

  it("an unknown stage still fails, and the message offers N/A", async () => {
    const preview = await previewBulkCreatives(fileOf(["Bulk-1,Product A,video,Consideration"]));
    expect(preview.rows[0]?.ok).toBe(false);
    expect(preview.rows[0]?.errors.join(" ")).toContain(NA_STAGE);
  });

  it("an EMPTY stage cell is still unassigned — not N/A", async () => {
    const preview = await previewBulkCreatives(fileOf(["Bulk-1,Product A,video,"]));
    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0]?.stages).toEqual([]);
  });

  /**
   * The two surfaces read "N/A" oppositely, and they must not be conflated:
   * the ads/performance pipeline treats it as an EMPTY NUMERIC cell (→ 0) via
   * `csv/numeric.ts`; the creative bulk import reads it as a stage VALUE. This
   * file's parser is `csv/parse.ts` (raw cells) and never touches that
   * normalizer — if someone routes the stage column through it, this fails.
   */
  it("does NOT share the performance CSV's numeric empty-marker convention", async () => {
    // The performance side: "N/A" in a numeric cell means "nothing here".
    expect(isEmptyMarker("N/A")).toBe(true);
    expect(isEmptyMarker("na")).toBe(false); // it is not even the same alias set

    // The creative side: the SAME text is a real, stored stage value.
    const preview = await previewBulkCreatives(fileOf(["Bulk-1,Product A,video,N/A"]));
    expect(preview.rows[0]?.stages).toEqual([NA_STAGE]);
  });
});
