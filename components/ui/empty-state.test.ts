import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { EMPTY_HINTS } from "@/components/ui/empty-state";

/**
 * D24 (2026-10): ONE empty-state primitive, ONE hint per kind. Twenty-odd
 * surfaces hand-rolled the same dashed box and most said only what was
 * missing — a dead end. The hints are user-facing copy, so they are pinned.
 */
const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(p);
  }
  return out;
}

describe("the empty state", () => {
  it("has one hint per kind", () => {
    expect(EMPTY_HINTS).toEqual({
      filtered: "Try a wider date range or clear filters.",
      range: "Try a wider date range.",
      filters: "Try clearing filters.",
    });
  });

  it("is never hand-rolled again", () => {
    const rogue = [...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "app"))]
      .map((f) => path.relative(ROOT, f))
      .filter((f) => f !== "components/ui/empty-state.tsx")
      .filter((f) =>
        /border-dashed border-line bg-surface[^"]*text-center|className="h-\d+ flex items-center justify-center text-ink-3 text-sm border border-dashed/.test(
          readFileSync(path.join(ROOT, f), "utf8"),
        ),
      );
    expect(rogue, "use <EmptyState> (components/ui/empty-state.tsx)").toEqual([]);
  });
});
