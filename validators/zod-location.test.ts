import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * RULES-CENSUS GUARD (2026-11-19) — "all inputs are validated through Zod
 * schemas in `validators/`", promoted from prose to a test.
 *
 * The rule had been false for months: sixteen server actions and API routes
 * built their schemas inline, while the tech spec carried "open conflict"
 * against CLAUDE.md. A rule that is simply false teaches people to skim the
 * section it lives in. The schemas moved here verbatim (same checks, same
 * messages); a code file outside `validators/` may now import zod only for
 * TYPES (`import type { z } from "zod"`), never to build a schema.
 *
 * TWO exemptions, each a different kind of thing rather than a convenience:
 *  - `lib/mcp/tools.ts` — an MCP tool's input schema IS the tool's definition
 *    (it is published to the client as the tool's JSON schema), so it lives
 *    with the tool.
 *  - `price-structure/schema.ts` — the Price Structure module's document
 *    schema, part of that isolated module by design (CLAUDE.md Stack,
 *    docs/decisions/price-structure.md).
 */

const ROOT = process.cwd();
const SCANNED = ["app", "components", "lib", "db", "csv", "store", "price-structure"];
const EXEMPT = new Set(["lib/mcp/tools.ts", "price-structure/schema.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      out.push(path.relative(ROOT, p));
  }
  return out;
}

/** A runtime import of zod — `import type` is fine, it builds nothing. */
const RUNTIME_ZOD = /^import (?!type\b)[^;]*?from ["']zod["']/m;

const files = SCANNED.flatMap((d) => walk(path.join(ROOT, d)));

describe("input schemas live in validators/", () => {
  it("no code file outside validators/ builds a zod schema (two named exemptions)", () => {
    const rogue = files.filter(
      (f) => !EXEMPT.has(f) && RUNTIME_ZOD.test(readFileSync(path.join(ROOT, f), "utf8")),
    );
    expect(rogue, "move the schema into validators/<domain>.ts and import it").toEqual([]);
  });

  it("each exemption is still real — delete it from the list when it stops being one", () => {
    for (const f of EXEMPT) {
      expect(RUNTIME_ZOD.test(readFileSync(path.join(ROOT, f), "utf8")), f).toBe(true);
    }
  });

  it("the pattern tells a runtime import from a type-only one", () => {
    expect(RUNTIME_ZOD.test('import { z } from "zod";')).toBe(true);
    expect(RUNTIME_ZOD.test("import * as z from 'zod';")).toBe(true);
    expect(RUNTIME_ZOD.test('import type { z } from "zod";')).toBe(false);
  });

  it("the walk really covers the actions and routes", () => {
    expect(files).toContain("app/actions/user.ts");
    expect(files).toContain("app/api/uploads/commit/route.ts");
  });
});
