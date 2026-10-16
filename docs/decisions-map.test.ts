import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * STRUCTURE GUARD for the 2026-10 context restructure.
 *
 * CLAUDE.md shrank from 2,248 lines to a rules file plus a DOMAIN MAP, and the
 * history moved to `docs/decisions/*`. That only works while the map and the
 * files agree: a pointer to a file nobody wrote sends the next session looking
 * for rules that aren't there, and a file nothing points at is a file nobody
 * reads. Both failures are silent, so they are a test.
 */

const ROOT = process.cwd();
const CLAUDE = readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
const DIR = path.join(ROOT, "docs/decisions");

const pointers = [...CLAUDE.matchAll(/`docs\/decisions\/([a-z-]+)\.md`/g)].map((m) => m[1]!);
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, ""));

describe("the domain map and docs/decisions agree", () => {
  it("every pointer in CLAUDE.md resolves to a file", () => {
    const dangling = [...new Set(pointers)].filter((p) => !files.includes(p));
    expect(dangling, "CLAUDE.md points at a decisions file that does not exist").toEqual([]);
  });

  it("every decisions file is pointed at", () => {
    const orphans = files.filter((f) => !pointers.includes(f));
    expect(orphans, "a decisions file nothing points at is one nobody reads").toEqual([]);
  });

  it("every decisions file leads with its INVARIANTS", () => {
    // The file's job is to answer "what must I not break?" BEFORE it answers
    // "why" — if the history floats to the top, the file is just the old
    // Learned section in a new place.
    for (const f of files) {
      const src = readFileSync(path.join(DIR, `${f}.md`), "utf8");
      const inv = src.indexOf("## Invariants");
      const hist = src.indexOf("## History and rationale");
      expect(inv, `${f}.md has no Invariants section`).toBeGreaterThan(-1);
      expect(hist, `${f}.md has no History section`).toBeGreaterThan(-1);
      expect(inv, `${f}.md puts history before invariants`).toBeLessThan(hist);
      expect(src.slice(inv, hist).split("\n").filter((l) => l.startsWith("- ")).length)
        .toBeGreaterThan(1);
    }
  });

  it("CLAUDE.md stays a RULES file, not a history", () => {
    // The whole point of the restructure. A soft ceiling with room to grow:
    // if this fails, the right fix is usually moving prose to a domain file,
    // not raising the number.
    const lines = CLAUDE.split("\n").length;
    expect(lines, "CLAUDE.md is growing back into a narrative").toBeLessThan(600);
  });
});
