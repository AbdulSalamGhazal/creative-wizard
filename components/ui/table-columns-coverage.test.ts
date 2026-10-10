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

/**
 * Tables that deliberately have NO columns control. Each line is a decision,
 * not an oversight — adding one here should feel like it needs an argument.
 */
const EXEMPT: Record<string, string> = {
  "components/budget/budget-plan-editor.tsx":
    "an EDITOR, not a data table — its columns are the plan's own axes (platform × bucket), and hiding one would hide money being planned",
  "components/budget/budget-tracker.tsx":
    "the BARS view is a chart made of rows; its TABLE view carries the control (same file, one DataTable each)",
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
