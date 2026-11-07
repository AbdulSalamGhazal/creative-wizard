import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Lexical guards for the design-system spellings the UI audit (2026-11)
 * settled: each one names ONE way to say a thing, because two spellings of
 * the same idea is how the next surface copies the wrong one.
 */
const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}
const SOURCES = ["components", "app", "lib", "price-structure"]
  .flatMap((d) => walk(path.join(ROOT, d)))
  .map((f) => ({ file: path.relative(ROOT, f), text: readFileSync(f, "utf8") }));

/** Every string literal in a source, with its 1-based line. */
function literals(text: string): { body: string; line: number }[] {
  const out: { body: string; line: number }[] = [];
  const re = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ body: m[0].slice(1, -1), line: text.slice(0, m.index).split("\n").length });
  }
  return out;
}

function offenders(test: (body: string) => boolean): string[] {
  return SOURCES.flatMap(({ file, text }) =>
    literals(text)
      .filter((l) => test(l.body))
      .map((l) => `${file}:${l.line}`),
  );
}

describe("design-system spellings", () => {
  it("tabular figures are `tabular-nums` — the old `.num` class is gone (R-091)", () => {
    // A class list containing the bare token `num` (not `kind: "num"`).
    const rogue = offenders((b) => /\s/.test(b.trim()) && /(^|\s)num(\s|$)/.test(b));
    expect(rogue, "write tabular-nums").toEqual([]);
  });

  it("a colour token is spelled by its utility, never as an arbitrary var (R-090)", () => {
    const rogue = offenders((b) =>
      /\b(bg|text|border|ring|accent)-\[var\(--(brand|brand-soft|brand-glow|primary-foreground)\)\]/.test(b),
    );
    expect(rogue, "use bg-brand / bg-brand-soft / text-primary-foreground").toEqual([]);
  });
});
