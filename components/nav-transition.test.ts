import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * W3-6 (2026-10): every route or search-param change shows the progress bar
 * (ui-system "Any route/search-param change goes through useNavTransition").
 * A `router.push`/`router.replace` must sit inside a nav transition's
 * `start…(() => …)` — the scatter points, the bell, the Compare metric
 * blocks and the after-save navigations all bypassed it. The SHALLOW writes
 * (history API, lib/shallow-url) render nothing and are not router calls.
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

/** Places a bare router navigation is deliberate, each with its reason. */
const BARE_OK: Record<string, string> = {
  "components/auth/signin-form.tsx":
    "the sign-in page has no app chrome (no progress bar) — the form's own pending state is the feedback",
};

describe("router navigations go through the nav transition", () => {
  it("no bare router.push / router.replace", () => {
    const offenders: string[] = [];
    for (const file of [...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "app"))]) {
      const rel = path.relative(ROOT, file);
      if (rel in BARE_OK) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/\brouter\.(push|replace)\(/.test(line)) return;
        // The call is wrapped when a transition opens on this line or the one
        // before it (`startNav(() =>` / `startTransition(() =>`).
        const window = `${lines[i - 1] ?? ""}\n${line}`;
        if (/start\w*\(\s*(async\s*)?\(\)\s*=>/.test(window)) return;
        offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("no route component uses React's bare useTransition to navigate", () => {
    const src = readFileSync(path.join(ROOT, "components/compare/metric-blocks.tsx"), "utf8");
    expect(src).toContain("useNavTransition()");
    expect(src).not.toMatch(/\buseTransition\(\)/);
  });
});
