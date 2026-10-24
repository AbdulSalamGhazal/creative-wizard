import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * WHAT MUST NEVER REACH THE BROWSER (W2-6, 2026-10).
 *
 * Two imports shipped server code to every user:
 *  - `db/schema.ts` runs `pgTable(…)` at module scope, so it can't be
 *    tree-shaken: a client component or validator that read ONE enum from it
 *    shipped all 42 tables, every table and column name (`oauth_tokens`,
 *    `api_tokens`, …) and drizzle's SQL builder — 13 KB gz on 11 routes.
 *  - the upload dropzone read the 4 MB limit from `csv/parse`, which imports
 *    SheetJS (47 KB gz) — on three pages that never parse a workbook.
 *
 * This walks the import graph from every `"use client"` module — static and
 * dynamic imports and re-exports, type-only imports skipped (erased), and
 * stopping at `"use server"` modules (the client gets a reference, not the
 * code) — and fails if it reaches either. The build's chunks are the proof;
 * this is the guard that keeps it true.
 */

const REPO = process.cwd();
const FORBIDDEN = new Map<string, string>([
  [path.join(REPO, "db/schema.ts"), "the Drizzle schema"],
  [path.join(REPO, "lib/db.ts"), "the database client"],
]);
const FORBIDDEN_PACKAGES = new Map<string, string>([["xlsx", "SheetJS"]]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const directive = (src: string, d: string) => new RegExp(`^\\s*["']${d}["']`).test(src);

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(REPO, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // a package
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Every module specifier this file pulls in at RUNTIME (type-only skipped). */
function runtimeSpecifiers(src: string): string[] {
  const out: string[] = [];
  // import x from "y" · import { a, b } from "y" · import * as z from "y" · import "y"
  const importRe = /import\s+(type\s+)?([^"';]*?)\s*from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(importRe)) {
    if (m[4]) {
      out.push(m[4]);
      continue;
    }
    if (m[1]) continue; // `import type …`
    const clause = m[2]!.trim();
    const braces = clause.match(/^\{([^}]*)\}$/);
    if (braces) {
      const names = braces[1]!.split(",").map((n) => n.trim()).filter(Boolean);
      if (names.length > 0 && names.every((n) => n.startsWith("type "))) continue;
    }
    out.push(m[3]!);
  }
  for (const m of src.matchAll(/export\s+(type\s+)?(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g)) {
    if (!m[1]) out.push(m[2]!);
  }
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]!);
  return out;
}

function clientReach(): Map<string, string[]> {
  /** module → the import chain that reached it */
  const seen = new Map<string, string[]>();
  const roots = [...walk(path.join(REPO, "app")), ...walk(path.join(REPO, "components")), ...walk(path.join(REPO, "lib"))]
    .filter((f) => directive(readFileSync(f, "utf8"), "use client"));
  const queue: Array<[string, string[]]> = roots.map((r) => [r, [path.relative(REPO, r)]]);
  while (queue.length > 0) {
    const [file, chain] = queue.shift()!;
    if (seen.has(file)) continue;
    seen.set(file, chain);
    const src = readFileSync(file, "utf8");
    if (directive(src, "use server") && chain.length > 1) continue;
    for (const spec of runtimeSpecifiers(src)) {
      const pkg = FORBIDDEN_PACKAGES.get(spec);
      if (pkg) {
        seen.set(`pkg:${spec}`, [...chain, spec]);
        continue;
      }
      const target = resolve(file, spec);
      if (target && !seen.has(target)) queue.push([target, [...chain, path.relative(REPO, target)]]);
    }
  }
  return seen;
}

describe("client bundles", () => {
  const reach = clientReach();

  it("the scan reaches the shared modules it should (it works)", () => {
    expect(reach.has(path.join(REPO, "lib/enums.ts"))).toBe(true);
    expect(reach.has(path.join(REPO, "csv/limits.ts"))).toBe(true);
  });

  it("no client module reaches the database schema or client", () => {
    const hits = [...FORBIDDEN.entries()]
      .filter(([file]) => reach.has(file))
      .map(([, what]) => what);
    const chains = [...FORBIDDEN.keys()]
      .filter((f) => reach.has(f))
      .map((f) => reach.get(f)!.join(" → "));
    expect({ hits, chains }).toEqual({ hits: [], chains: [] });
  });

  it("no client module reaches SheetJS", () => {
    const chains = [...FORBIDDEN_PACKAGES.keys()]
      .filter((p) => reach.has(`pkg:${p}`))
      .map((p) => reach.get(`pkg:${p}`)!.join(" → "));
    expect(chains).toEqual([]);
  });
});
