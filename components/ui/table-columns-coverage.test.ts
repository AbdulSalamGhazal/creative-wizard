import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { TABLE_KEY_LIST } from "@/lib/table-columns";

/**
 * COVERAGE GUARD for the unified columns system (phase 2, 2026-10).
 *
 * The point of putting the control on the primitive was that the NEXT table
 * gets it for free — which only holds if somebody notices when one doesn't.
 * So: every `<DataTable>` in the app either passes a `columnsKey` (directly or
 * by spreading `useTableColumns(...).tableProps`) or appears on the exemption
 * list below, with the reason written down.
 *
 * It also pins that the retired per-browser hooks are gone, because the whole
 * point is ONE place where a column choice lives.
 */

const REPO = process.cwd();

/** The two grouped-header tables, which place the control themselves. */
const GROUPED_TWINS = [
  "components/summary/summary-table.tsx",
  "components/store/reconciliation-view.tsx",
];

/**
 * Tables that deliberately have NO columns control. Each line is a decision,
 * not an oversight — adding one here should feel like it needs an argument.
 */
const EXEMPT: Record<string, string> = {
  // Two tables used to be listed here and both earned their way off: the
  // Budget plan editor (an editor, not a data table; its view-mode DataTable
  // went in 2026-10) and the Tracker's bars view (a chart made of rows; the
  // Tracker merged into Pacing in 2026-10-19 and its board is not a DataTable,
  // while its table view carries the control). Empty is the goal.
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(p);
  }
  return out;
}

function tableFiles(): string[] {
  return [...walk(path.join(REPO, "components")), ...walk(path.join(REPO, "app"))]
    .filter((f) => /<DataTable[<\s]/.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(REPO, f));
}

/**
 * HAND-ROLLED `<table>`s (W3-9 / D22, 2026-10). The guard above only saw
 * files containing `<DataTable`, so four analytics/history tables built by
 * hand (Trends → Types, the Funnel platform comparison, both upload
 * histories) passed it while the docs said "no table is hand-rolled". Those
 * four moved to DataTable; the rest are named here with their reason —
 * admin lists and editors, decided in D22 — and a new one fails the build.
 */
const HAND_ROLLED_OK: Record<string, string> = {
  "components/ui/data-table.tsx": "the primitive itself",
  "components/summary/summary-table.tsx": "a grouped-header twin (per-platform column groups)",
  "components/store/reconciliation-view.tsx": "a grouped-header twin (Store · Claim · Δ · Δ% per platform)",
  "components/account/accounts-admin.tsx": "an admin list with inline edit rows, not a data table (D22)",
  "components/angle/angles-table.tsx": "an admin list with inline rename/delete rows (D22)",
  "components/landing-page/landing-pages-table.tsx": "an admin list with inline edit rows (D22)",
  "components/platform/mappings-admin.tsx": "an admin editor of header mappings (D22)",
  "components/product/products-admin.tsx": "an admin list with archive/restore rows (D22)",
  "components/budget/audience-board.tsx": "the stage × platform pressure MATRIX — cells, not rows of records",
  "components/budget/audience-record-dialog.tsx": "an input grid inside a dialog (an editor)",
  "components/budget/budget-plan-revisions.tsx": "a revision snapshot's read-only allocation list in a drawer",
  "components/budget/budget-plan-upload.tsx": "the parsed sheet's preview before it is saved",
  "components/creative/bulk-creative-import.tsx": "the validated import preview before commit",
};

describe("no flat data table is hand-rolled", () => {
  it("every <table> is DataTable's own, or named here with its reason", () => {
    const rogue = [...walk(path.join(REPO, "components")), ...walk(path.join(REPO, "app"))]
      .map((f) => path.relative(REPO, f))
      .filter((f) => /<table[\s>]/.test(readFileSync(path.join(REPO, f), "utf8")))
      .filter((f) => !(f in HAND_ROLLED_OK));
    expect(rogue, "use DataTable (with a columnsKey), or name the exception").toEqual([]);
  });
  it("every named exception still hand-rolls a table", () => {
    for (const [file, why] of Object.entries(HAND_ROLLED_OK)) {
      expect(/<table[\s>]/.test(readFileSync(path.join(REPO, file), "utf8")), file).toBe(true);
      expect(why.length).toBeGreaterThan(12);
    }
  });
});

describe("every table has the columns control", () => {
  it("…or is on the exemption list, with a reason", () => {
    const missing: string[] = [];
    for (const file of tableFiles()) {
      const src = readFileSync(path.join(REPO, file), "utf8");
      const wired =
        src.includes("cols.tableProps") ||
        src.includes("columnsKey=") ||
        /\{\.\.\.\w*[Cc]ols\.tableProps\}/.test(src);
      if (!wired && !(file in EXEMPT)) missing.push(file);
    }
    expect(missing, "pass a columnsKey (useTableColumns) or add an exemption").toEqual(
      [],
    );
  });

  it("every exemption still exists and still has a table", () => {
    // A stale exemption is how a list like this rots into permission to skip.
    const files = new Set(tableFiles());
    for (const file of Object.keys(EXEMPT)) {
      expect(files.has(file), `${file} is exempt but has no DataTable any more`).toBe(
        true,
      );
      expect(EXEMPT[file]!.length).toBeGreaterThan(20);
    }
  });

  it("the per-browser column hooks are gone", () => {
    // One place for a column choice: the user's account, per brand. The old
    // localStorage hooks were deleted in phase 2, not left as a second path.
    const all = [...walk(path.join(REPO, "components"))].map((f) => readFileSync(f, "utf8"));
    for (const hook of ["usePersistentHidden", "usePersistentVisible"]) {
      expect(all.some((src) => src.includes(hook)), `${hook} is still used`).toBe(false);
    }
  });

  it("the control is only ever placed by TableCorner", () => {
    // Part of the 2026-10 fix: the button lives IN the header row, costing no
    // vertical space. Every file that renders the control renders it inside
    // the shared corner — a hand-placed one is how the extra line comes back.
    for (const file of ["components/ui/data-table.tsx", ...GROUPED_TWINS]) {
      const src = readFileSync(path.join(REPO, file), "utf8");
      expect(src, file).toContain("TableCorner");
    }
  });

  it("every key a table passes is in the registry", () => {
    const keys = new Set<string>(TABLE_KEY_LIST);
    const used = new Set<string>();
    for (const file of tableFiles().concat([
      "components/summary/summary-table.tsx",
      "components/store/reconciliation-view.tsx",
    ])) {
      const src = readFileSync(path.join(REPO, file), "utf8");
      for (const m of src.matchAll(/TABLE_KEYS\.([A-Z_]+)/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(10);
    // Every referenced constant resolves to a declared key.
    const declared = new Set(
      readFileSync(path.join(REPO, "lib/table-columns.ts"), "utf8")
        .matchAll(/^\s{2}([A-Z_]+): "/gm),
    );
    const declaredNames = new Set([...declared].map((m) => m[1]!));
    for (const name of used) expect(declaredNames.has(name), `TABLE_KEYS.${name}`).toBe(true);
    expect(keys.size).toBe(declaredNames.size);
  });
});

/**
 * THE CATALOG RULE (2026-10): a table OFFERS every field its query already
 * carries at the row's grain, `defaultHidden`, so nothing changes until
 * somebody opts in. These are source-level guards in the house style — the
 * point of the rule is that the next person adds a field to the query AND to
 * the catalog, and a test is what notices when they don't.
 */
describe("the catalog offers the data the page already has", () => {
  const OFFERED: Record<string, string[]> = {
    // Campaign detail → creatives: the creative's own identity.
    "components/campaign/campaign-creatives-table.tsx": [
      "status",
      "type",
      "productName",
      "stages",
      "priority",
      "launchDate",
    ],
    // Creative detail → campaigns/platforms: the counts behind the rates.
    "components/creative/creative-campaigns-table.tsx": [
      "impressions",
      "clicks",
      "landingPageViews",
    ],
    // Trends → Types: the clicks behind CTR/CPC (D22).
    "components/trends/type-rollup-table.tsx": ["clicks"],
    // Funnel → platforms: the counts behind each rate (D22).
    "components/funnel/platform-funnel-comparison.tsx": [
      "impressions",
      "clicks",
      "landingPageViews",
      "addToCart",
      "addPayment",
    ],
    // Trends → Video: the raw plays a retention rate is a fraction of.
    "components/trends/video-diagnostics-table.tsx": [
      "v2s",
      "v25",
      "v50",
      "v75",
      "v100",
      "clicks",
      "conversions",
      "revenue",
    ],
  };

  it("each table declares its added columns", () => {
    for (const [file, keys] of Object.entries(OFFERED)) {
      const src = readFileSync(path.join(REPO, file), "utf8");
      for (const key of keys) {
        expect(src, `${file} → ${key}`).toContain(`key: "${key}"`);
      }
    }
  });

  it("…and ships them HIDDEN, so no page changed shape", () => {
    // A catalog column that arrives visible is a redesign nobody asked for.
    for (const file of [
      "components/campaign/campaign-creatives-table.tsx",
      "components/creative/creative-campaigns-table.tsx",
      "components/trends/video-diagnostics-table.tsx",
      "components/trends/launch-fatigue.tsx",
      "components/budget/audience-board.tsx",
      "components/trends/type-rollup-table.tsx",
      "components/funnel/platform-funnel-comparison.tsx",
    ]) {
      const src = readFileSync(path.join(REPO, file), "utf8");
      expect(src, file).toContain("defaultHidden");
    }
  });
});
