import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * RULES-CENSUS GUARD (2026-10) — the Stack section's one dependency rule,
 * promoted from prose to a test.
 *
 * `@xyflow/react` is the only dependency added in months. It was approved on
 * three conditions, all of which are invisible at review time and none of
 * which the build would complain about:
 *   1. EXACT-pinned (no `^`), because a minor bump to a canvas library is a
 *      silent visual change across a page nobody re-screenshots;
 *   2. ONE importer, so it stays a lazy chunk instead of leaking into shared
 *      JS the moment a second component reaches for it;
 *   3. loaded through `next/dynamic` with `ssr: false`, which is what keeps it
 *      off every other route's first load.
 *
 * Verified in the build when it landed (~57 kB gz on /canvas only). This is
 * the cheap, permanent version of that verification.
 */

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      out.push(path.relative(ROOT, p));
  }
  return out;
}

const LIB = "@xyflow/react";
const IMPORTER = "components/canvas/canvas-flow.tsx";

describe("the one added dependency keeps its shape", () => {
  it("is EXACT-pinned", () => {
    const v = pkg.dependencies[LIB];
    expect(v, `${LIB} is not a dependency any more`).toBeTruthy();
    expect(v, "an exact pin: a minor bump to the canvas is a silent visual change").toMatch(
      /^\d+\.\d+\.\d+$/,
    );
  });

  it("has exactly ONE importer", () => {
    const files = ["components", "app", "lib"].flatMap((d) => walk(path.join(ROOT, d)));
    // Match the exact specifier anywhere: the real import is multi-line
    // (a named list), and `"@xyflow/react/dist/style.css"` is a DIFFERENT
    // specifier that must not count as an importer of the library.
    const importers = files.filter((f) =>
      new RegExp(`from "${LIB}"`).test(readFileSync(path.join(ROOT, f), "utf8")),
    );
    expect(importers, "a second importer pulls it out of its lazy chunk").toEqual([IMPORTER]);
  });

  it("is loaded lazily, client-side only", () => {
    // The loader lives in the component that renders the importer.
    const view = readFileSync(path.join(ROOT, "components/canvas/canvas-view.tsx"), "utf8");
    expect(view).toContain("next/dynamic");
    expect(view).toMatch(/ssr:\s*false/);
  });
});
