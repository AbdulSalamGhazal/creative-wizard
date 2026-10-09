import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * THE RSC BOUNDARY GUARD — a prod outage turned into a test (2026-10).
 *
 * /campaigns went down with the error boundary because a SERVER page imported
 * a plain value (`CAMPAIGN_TABLE_COLUMNS`) out of a `"use client"` module.
 * Every export of a client module is a CLIENT-REFERENCE PROXY on the server,
 * so reading it throws at request time — and nothing catches that: typecheck
 * is green, `next build` is green, the unit suites are green, and the esbuild
 * rig never renders on a server at all. Only a real Next render fails, which
 * is exactly the gate that was missing.
 *
 * The rule: **a server component may import a client COMPONENT, never a VALUE
 * from a client module.** Shared data goes in a plain module both sides import
 * (see `components/portfolio/portfolio-columns.ts`).
 *
 * This walks every server file under `app/` and fails on a non-component
 * named import from a client module. `import type` is erased at compile time,
 * so it is allowed; a PascalCase binding is taken to be a component.
 */

const REPO = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const isClientModule = (file: string): boolean =>
  /^\s*["']use client["']/.test(readFileSync(file, "utf8"));

/** `@/foo/bar` → the real file, trying the usual extensions. */
function resolveAlias(spec: string): string | null {
  const base = path.join(REPO, spec.replace(/^@\//, ""));
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface Offence {
  file: string;
  spec: string;
  names: string[];
}

function findOffences(): Offence[] {
  const out: Offence[] = [];
  for (const file of walk(path.join(REPO, "app"))) {
    if (isClientModule(file)) continue; // a client file may import anything
    const src = readFileSync(file, "utf8");
    const importRe = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["'](@\/[^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(src)) !== null) {
      const [, typeOnly, names, spec] = m;
      if (typeOnly) continue;
      const target = resolveAlias(spec!);
      if (!target || !isClientModule(target)) continue;
      const bad = names!
        .split(",")
        .map((n) => n.trim().split(/\s+as\s+/)[0]!.trim())
        .filter((n) => n.length > 0 && !n.startsWith("type "))
        // PascalCase = a component, the one supported import across the line.
        .filter((n) => !/^[A-Z][A-Za-z0-9]*$/.test(n));
      if (bad.length > 0) out.push({ file: path.relative(REPO, file), spec: spec!, names: bad });
    }
  }
  return out;
}

describe("server files never import a VALUE from a client module", () => {
  it("holds across the whole app/ tree", () => {
    const offences = findOffences();
    const readable = offences.map((o) => `${o.file} ← ${o.spec}: ${o.names.join(", ")}`);
    expect(readable, "a server component cannot read an export of a client module").toEqual(
      [],
    );
  });

  it("would have caught the /campaigns outage", () => {
    // The guard is only worth having if it fails on the real bug, so this
    // reconstructs it: the page's own import line, pointed back at the client
    // table it used to come from.
    const page = readFileSync("app/(dashboard)/campaigns/page.tsx", "utf8");
    expect(page).toContain(
      'import { CAMPAIGN_TABLE_COLUMNS } from "@/components/portfolio/portfolio-columns";',
    );
    expect(page).not.toMatch(
      /import\s*\{[^}]*CAMPAIGN_TABLE_COLUMNS[^}]*\}\s*from\s*"@\/components\/portfolio\/portfolio-table"/,
    );
    // And the module it now comes from is NOT a client module.
    expect(isClientModule("components/portfolio/portfolio-columns.ts")).toBe(false);
    expect(isClientModule("components/portfolio/portfolio-table.tsx")).toBe(true);
  });
});
