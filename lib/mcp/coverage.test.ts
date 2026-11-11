import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_COVERAGE } from "./coverage";

const ROOT = path.resolve(__dirname, "../..");

const queryModules = readdirSync(path.join(ROOT, "db/queries"))
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => f.replace(/\.ts$/, ""))
  .sort();

const registeredTools = [
  ...readFileSync(path.join(ROOT, "lib/mcp/tools.ts"), "utf8").matchAll(
    /server\.registerTool\(\s*"([a-z_]+)"/g,
  ),
].map((m) => m[1] ?? "");

describe("MCP coverage register", () => {
  it("decides EVERY db/queries module — add a new one to lib/mcp/coverage.ts (a tool, or why not)", () => {
    const missing = queryModules.filter((m) => !(m in MCP_COVERAGE));
    expect(missing).toEqual([]);
  });

  it("names no module that no longer exists", () => {
    const stale = Object.keys(MCP_COVERAGE).filter((m) => !queryModules.includes(m));
    expect(stale).toEqual([]);
  });

  it("names only tools lib/mcp/tools.ts registers", () => {
    const unknown = Object.values(MCP_COVERAGE)
      .flatMap((c) => (c.mcp === "tools" ? c.tools : []))
      .filter((t) => !registeredTools.includes(t));
    expect(unknown).toEqual([]);
  });

  it("gives every 'no' a reason", () => {
    for (const [mod, c] of Object.entries(MCP_COVERAGE)) {
      if (c.mcp === "no") expect(c.why.trim().length, mod).toBeGreaterThan(10);
    }
  });

  it("every registered tool reads at least one module (none is orphaned from the register)", () => {
    const covered = new Set(
      Object.values(MCP_COVERAGE).flatMap((c) => (c.mcp === "tools" ? c.tools : [])),
    );
    expect(registeredTools.filter((t) => t !== "list_brands" && !covered.has(t))).toEqual([]);
  });
});
