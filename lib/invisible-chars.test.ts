import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * NO RAW INVISIBLE CHARACTERS IN SOURCE OR DOCS (2026-10-21 review).
 *
 * Bidi isolates, zero-width characters and the BOM render as NOTHING in an
 * editor, in grep output and in most diffs — a reviewer cannot see what the
 * code says (CLAUDE.md's invisible-character trap). lib/bidi.ts shipped its
 * FSI/PDI constants as raw U+2068/U+2069 under a comment promising escapes.
 * Write them as `\u2068`-style ESCAPES in code, and as visible notation
 * ("ع + ZWNJ + غ") in prose.
 *
 * Scope: the zero-width / bidi-mark range U+200B–U+200F, the isolates
 * U+2066–U+2069 and U+FEFF. (The U+0001 dedup-key separator CLAUDE.md
 * documents is a control character outside this range and is not scanned.)
 */

const ROOT = process.cwd();
const DIRS = ["app", "components", "lib", "db", "validators", "docs"];
const SKIP = new Set(["node_modules", ".next"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|md)$/.test(entry)) out.push(p);
  }
  return out;
}

const INVISIBLE = /[\u200B-\u200F\u2066-\u2069\uFEFF]/u;

describe("source and docs carry no raw invisible characters", () => {
  it("…anywhere under app/, components/, lib/, db/, validators/ or docs/", () => {
    const offenders: string[] = [];
    for (const file of DIRS.flatMap((d) => walk(path.join(ROOT, d)))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const hit = INVISIBLE.exec(line);
        if (hit) {
          const code = hit[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
          offenders.push(`${path.relative(ROOT, file)}:${i + 1} U+${code}`);
        }
      });
    }
    expect(offenders, "write it as an escape (\\u2068) in code, visible notation in prose").toEqual([]);
  });

  it("the pattern itself catches what it must (so an empty scan means something)", () => {
    for (const cp of [0x200b, 0x200c, 0x200f, 0x2066, 0x2069, 0xfeff]) {
      expect(INVISIBLE.test(`a${String.fromCodePoint(cp)}b`)).toBe(true);
    }
    expect(INVISIBLE.test("plain العربية text")).toBe(false);
  });
});
