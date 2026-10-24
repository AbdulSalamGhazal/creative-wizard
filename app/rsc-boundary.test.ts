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
 * This walks the SERVER MODULE GRAPH: every non-client file under `app/` (and
 * `middleware.ts`) is an entry, and every non-client module reachable from one
 * through `@/…` or relative imports is a server module — a server component in
 * `components/` or a helper in `lib/` breaks the rule the same way a page does.
 * The walk stops at a client module (past the line, everything is client).
 * For every server module it fails on:
 *  - a named or default import of a non-component binding from a client
 *    module (`import type` is erased at compile time, so it is allowed);
 *  - a namespace import of a client module (`import * as X`);
 *  - a re-export of a client module's value (`export { x } from`,
 *    `export * from`).
 * A component is PascalCase WITH a lowercase letter — an ALL-CAPS constant
 * (`MAX`, `COLUMNS`) is a value, never a component.
 *
 * W3-9 (2026-10): the first version scanned only `app/`, only `@/` named
 * imports, and read any capitalised binding as a component — so a server
 * component under `components/`, a relative import, a default or namespace
 * import, a re-export and an all-caps constant all passed unchecked.
 */

const REPO = process.cwd();

const SOURCE_RE = /\.tsx?$/;
const TEST_RE = /\.test\.tsx?$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SOURCE_RE.test(entry) && !TEST_RE.test(entry)) out.push(p);
  }
  return out;
}

const clientCache = new Map<string, boolean>();
const isClientModule = (file: string): boolean => {
  const abs = path.resolve(REPO, file);
  let v = clientCache.get(abs);
  if (v === undefined) {
    v = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(
      readFileSync(abs, "utf8"),
    );
    clientCache.set(abs, v);
  }
  return v;
};

/** An import specifier → the real file, trying the usual extensions; null for
 *  a package (or anything that isn't a repo file). */
function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(REPO, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../"))
    base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (SOURCE_RE.test(candidate) && existsSync(candidate) && statSync(candidate).isFile())
      return candidate;
  }
  return null;
}

/** PascalCase with at least one lowercase letter: `KpiCard`, not `MAX`. */
export const isComponentName = (n: string): boolean =>
  /^[A-Z](?=[A-Za-z0-9]*[a-z])[A-Za-z0-9]*$/.test(n);

interface ImportEdge {
  spec: string;
  /** Exported names read from the module (named imports / re-exports). */
  named: string[];
  /** A default import's binding. */
  defaultBinding: string | null;
  /** `import * as X` or `export * from`. */
  namespace: boolean;
  /** `export … from` — a re-export, not a local binding. */
  reexport: boolean;
}

/** Every static import/re-export in a source file (type-only ones dropped). */
export function parseImports(src: string): ImportEdge[] {
  const out: ImportEdge[] = [];
  const named = (inner: string) =>
    inner
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n.length > 0 && !n.startsWith("type "))
      .map((n) => n.split(/\s+as\s+/)[0]!.trim());
  const importRe = /^\s*import\s+(type\s+)?([^'";]*?)\s*from\s*["']([^"']+)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src)) !== null) {
    const [, typeOnly, clause, spec] = m;
    if (typeOnly) continue;
    const c = clause!.trim();
    const brace = /\{([^}]*)\}/.exec(c);
    const ns = /\*\s+as\s+[\w$]+/.test(c);
    const def = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(c);
    out.push({
      spec: spec!,
      named: brace ? named(brace[1]!) : [],
      defaultBinding: def ? def[1]! : null,
      namespace: ns,
      reexport: false,
    });
  }
  const sideEffectRe = /^\s*import\s+["']([^"']+)["']/gm;
  while ((m = sideEffectRe.exec(src)) !== null) {
    out.push({ spec: m[1]!, named: [], defaultBinding: null, namespace: false, reexport: false });
  }
  const reexportRe = /^\s*export\s+(type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/gm;
  while ((m = reexportRe.exec(src)) !== null) {
    const [, typeOnly, clause, spec] = m;
    if (typeOnly) continue;
    const star = clause!.startsWith("*");
    out.push({
      spec: spec!,
      named: star ? [] : named(clause!.slice(1, -1)),
      defaultBinding: null,
      namespace: star,
      reexport: true,
    });
  }
  return out;
}

interface Offence {
  file: string;
  spec: string;
  names: string[];
}

/** Server entries: every non-client source file under `app/`, plus middleware. */
function serverEntries(): string[] {
  return [
    ...walk(path.join(REPO, "app")),
    path.join(REPO, "middleware.ts"),
  ].filter((f) => existsSync(f) && !isClientModule(f));
}

/** The server module graph: entries plus every non-client module they reach. */
export function serverModules(): string[] {
  const seen = new Set<string>();
  const queue = serverEntries();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const edge of parseImports(readFileSync(file, "utf8"))) {
      const target = resolveSpec(edge.spec, file);
      if (target && !isClientModule(target) && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen].sort();
}

function findOffences(): Offence[] {
  const out: Offence[] = [];
  for (const file of serverModules()) {
    for (const edge of parseImports(readFileSync(file, "utf8"))) {
      const target = resolveSpec(edge.spec, file);
      if (!target || !isClientModule(target)) continue;
      const bad = [
        ...edge.named.filter((n) => !isComponentName(n)),
        ...(edge.defaultBinding && !isComponentName(edge.defaultBinding)
          ? [`default as ${edge.defaultBinding}`]
          : []),
        ...(edge.namespace ? [edge.reexport ? "export *" : "import * as"] : []),
      ];
      if (bad.length > 0)
        out.push({ file: path.relative(REPO, file), spec: edge.spec, names: bad });
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

describe("the guard sees every way across the line (W3-9)", () => {
  it("components are PascalCase with a lowercase letter; ALL-CAPS is a value", () => {
    expect(isComponentName("KpiCard")).toBe(true);
    expect(isComponentName("X1Chart")).toBe(true);
    expect(isComponentName("MAX")).toBe(false);
    expect(isComponentName("COLUMNS")).toBe(false);
    expect(isComponentName("CAMPAIGN_TABLE_COLUMNS")).toBe(false);
    expect(isComponentName("useThing")).toBe(false);
  });

  it("parses default, namespace, relative and re-export forms", () => {
    const edges = parseImports(
      [
        'import Thing, { a, type B, C as D } from "./client-thing";',
        'import * as NS from "../ns";',
        'import type { T } from "@/types-only";',
        'export { x, Y } from "@/re";',
        'export * from "@/star";',
        'export type { Z } from "@/zed";',
        "import {",
        "  multi,",
        "  Line,",
        '} from "@/multi";',
      ].join("\n"),
    );
    const by = (spec: string) => edges.find((e) => e.spec === spec);
    expect(by("./client-thing")).toMatchObject({ defaultBinding: "Thing", named: ["a", "C"] });
    expect(by("../ns")).toMatchObject({ namespace: true });
    expect(by("@/types-only")).toBeUndefined();
    expect(by("@/re")).toMatchObject({ reexport: true, named: ["x", "Y"] });
    expect(by("@/star")).toMatchObject({ reexport: true, namespace: true });
    expect(by("@/zed")).toBeUndefined();
    expect(by("@/multi")).toMatchObject({ named: ["multi", "Line"] });
  });

  it("walks past app/ into the server components and helpers it reaches", () => {
    const mods = serverModules().map((f) => path.relative(REPO, f));
    // A server component under components/ and a lib helper are both in it.
    expect(mods).toContain("components/layout/page-header.tsx");
    expect(mods.some((f) => f.startsWith("lib/"))).toBe(true);
    // …and the walk stops at the line: no client module is a server module.
    expect(mods.filter((f) => isClientModule(f))).toEqual([]);
  });
});
