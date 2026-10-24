import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  creativeTypeEnum,
  exclusionRuleKindEnum,
  roleEnum,
  storeFieldTypeEnum,
} from "@/lib/enums";
import * as schema from "@/db/schema";
import { TYPE_LABEL, TYPE_OPTIONS, TYPE_ORDER } from "@/lib/palette";
import { CREATIVE_STATUSES } from "@/lib/creative-status";

/**
 * DERIVE, DON'T RE-LIST (CLAUDE.md "Traps"; W3-8, 2026-10). Every vocabulary
 * the database stores has ONE list; a validator, an option list or a type
 * reads it. The consistency audit found the roles, the exclusion-rule kinds,
 * the store field types, the MCP status filter and the creative types (six
 * times) hand-copied — each a drift bug waiting for the next value.
 */

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      out.push(path.relative(ROOT, p));
  }
  return out;
}

/** A literal list of these exact values, in any order, quoted either way. */
function literalList(values: readonly string[]): RegExp {
  const item = `["'](?:${values.join("|")})["']`;
  return new RegExp(`\\[\\s*${item}(?:\\s*,\\s*${item}){${values.length - 1}}\\s*,?\\s*\\]`);
}

describe("the schema re-exports the browser-safe vocabularies", () => {
  it("one list each", () => {
    expect(schema.roleEnum).toBe(roleEnum);
    expect(schema.exclusionRuleKindEnum).toBe(exclusionRuleKindEnum);
    expect(schema.storeFieldTypeEnum).toBe(storeFieldTypeEnum);
    expect(schema.creativeTypeEnum).toBe(creativeTypeEnum);
  });
});

describe("type display order and options derive from TYPE_LABEL", () => {
  it("cover every creative type exactly once", () => {
    expect([...TYPE_ORDER].sort()).toEqual([...creativeTypeEnum].sort());
    expect(TYPE_OPTIONS.map((o) => o.value)).toEqual(TYPE_ORDER);
    expect(TYPE_OPTIONS.every((o) => o.label === TYPE_LABEL[o.value])).toBe(true);
  });
});

describe("no source file re-lists a stored vocabulary", () => {
  const files = ["app", "components", "lib", "validators", "store", "db", "csv"]
    .flatMap((d) => walk(path.join(ROOT, d)))
    .filter((f) => f !== "lib/enums.ts" && !f.startsWith("db/migrations/"));
  const lists: Array<[string, readonly string[]]> = [
    ["roleEnum", roleEnum],
    ["exclusionRuleKindEnum", exclusionRuleKindEnum],
    ["storeFieldTypeEnum", storeFieldTypeEnum],
    ["creativeTypeEnum", creativeTypeEnum],
    ["CREATIVE_STATUSES", CREATIVE_STATUSES],
  ];
  for (const [name, values] of lists) {
    it(`${name} is listed once`, () => {
      const re = literalList(values);
      const copies = files.filter((f) => re.test(readFileSync(path.join(ROOT, f), "utf8")));
      // The canonical declaration of CREATIVE_STATUSES is its own module.
      const allowed = name === "CREATIVE_STATUSES" ? ["lib/creative-status.ts"] : [];
      expect(copies.filter((f) => !allowed.includes(f)), `derive from ${name}`).toEqual([]);
    });
  }
});
