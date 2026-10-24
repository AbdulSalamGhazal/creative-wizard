import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * D25/D26 (2026-10), the page chrome's copy rules, made checkable:
 *  · a page subtitle is ONE fact (a count, a range), so it is computed — a
 *    string LITERAL subtitle was always helper prose; a standing rule is the
 *    header's ⓘ (`info`);
 *  · a back link reads "Back to «Page»", and none points at the /trends
 *    redirect stub.
 */
const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry === "page.tsx") out.push(path.relative(ROOT, p));
  }
  return out;
}
const pages = walk(path.join(ROOT, "app"));

describe("page chrome copy", () => {
  it("no page carries a literal (prose) subtitle", () => {
    const prose = pages.filter((p) => /\bsubtitle="/.test(readFileSync(path.join(ROOT, p), "utf8")));
    expect(prose, "a standing rule goes in info=…; a purpose is the title").toEqual([]);
  });

  it("back links read 'Back to «Page»' and never point at /trends", () => {
    const bad: string[] = [];
    for (const p of pages) {
      const src = readFileSync(path.join(ROOT, p), "utf8");
      for (const m of src.matchAll(/backLink=\{\{\s*href:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)) {
        if (m[1] === "/trends" || !/^Back to [A-Z]/.test(m[2]!)) bad.push(`${p}: ${m[2]} → ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
