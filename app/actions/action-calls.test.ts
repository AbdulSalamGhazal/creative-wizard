import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * TWO GUARDS ON HOW THE CLIENT CALLS A SERVER ACTION (2026-10, W2-1 + W2-2).
 * The sibling of `comment-latency.test.ts`, which pins the comments half.
 *
 * 1. ONE RENDER PER ACTION. A server action that revalidates (or writes a
 *    cookie) already re-renders the caller's page and ships the tree in its
 *    response. A `router.refresh()` after it fetched a SECOND full render —
 *    every edit rendered twice, a date pick three times (~128 queries for one
 *    click on the Dashboard). So: a client file that calls a re-rendering
 *    action never calls `router.refresh()`. A caller that NAVIGATES away
 *    (create, delete, rename) is the other half: those actions don't
 *    revalidate at all, and the navigation is the one render — pinned below.
 *
 * 2. EVERY CALL GOES THROUGH `safeAction`. A rejected call (a network blink,
 *    or a tab from before the last deploy calling an action id the new server
 *    doesn't know) used to land on the route's error boundary and take the
 *    page — and the person's unsaved draft — with it. Every reference to an
 *    imported action in a client file must sit inside a `safeAction(…)` call.
 *
 * Both scans read CODE, not text: comments and string contents are blanked
 * first, so a comment that mentions `router.refresh()` can't trip them.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...listFiles(rel));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(rel);
  }
  return out;
}

/**
 * The source with comments, string/template TEXT and regex literals blanked
 * (offsets and newlines kept), and `${…}` template expressions left as code.
 */
export function codeOnly(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  // The last significant code character, to tell a regex `/` from a division.
  let prev = "";
  const scanCode = (stopAtBrace: boolean): void => {
    let depth = 0;
    while (i < src.length) {
      const c = src[i]!;
      const n = src[i + 1];
      if (c === "/" && n === "/") {
        const end = src.indexOf("\n", i);
        const stop = end === -1 ? src.length : end;
        blank(i, stop);
        i = stop;
        continue;
      }
      if (c === "/" && n === "*") {
        const end = src.indexOf("*/", i + 2);
        const stop = end === -1 ? src.length : end + 2;
        blank(i, stop);
        i = stop;
        continue;
      }
      if (c === '"' || c === "'") {
        const start = i;
        i++;
        while (i < src.length && src[i] !== c && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
        blank(start + 1, i);
        i++;
        prev = "a";
        continue;
      }
      if (c === "`") {
        i++;
        let textStart = i;
        while (i < src.length && src[i] !== "`") {
          if (src[i] === "\\") {
            i += 2;
            continue;
          }
          if (src[i] === "$" && src[i + 1] === "{") {
            blank(textStart, i);
            i += 2;
            scanCode(true);
            textStart = i;
            continue;
          }
          i++;
        }
        blank(textStart, i);
        i++;
        prev = "a";
        continue;
      }
      if (c === "/" && (prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev))) {
        // A regex literal.
        const start = i;
        i++;
        let inClass = false;
        while (i < src.length && src[i] !== "\n") {
          if (src[i] === "\\") {
            i += 2;
            continue;
          }
          if (src[i] === "[") inClass = true;
          else if (src[i] === "]") inClass = false;
          else if (src[i] === "/" && !inClass) break;
          i++;
        }
        blank(start + 1, i);
        i++;
        prev = "a";
        continue;
      }
      if (stopAtBrace) {
        if (c === "{") depth++;
        else if (c === "}") {
          if (depth === 0) {
            i++;
            return;
          }
          depth--;
        }
      }
      if (!/\s/.test(c)) prev = c;
      i++;
    }
  };
  scanCode(false);
  return out.join("");
}

const lineOf = (src: string, offset: number) => src.slice(0, offset).split("\n").length;

/** [start, end) of every `safeAction( … )` call's argument list. */
function safeActionSpans(code: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of code.matchAll(/\bsafeAction\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    let depth = 0;
    for (let k = open; k < code.length; k++) {
      if (code[k] === "(") depth++;
      else if (code[k] === ")" && --depth === 0) {
        spans.push([open, k]);
        break;
      }
    }
  }
  return spans;
}

interface ActionImport {
  name: string;
  module: string;
  /** Offsets of the import statement, which is not a call. */
  range: [number, number];
}

function actionImports(src: string): ActionImport[] {
  const out: ActionImport[] = [];
  const re = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*"@\/app\/actions\/([^"]+)"\s*;?/g;
  for (const m of src.matchAll(re)) {
    if (m[1]) continue; // `import type { … }` — erased, never called
    for (const spec of m[2]!.split(",")) {
      const s = spec.trim();
      if (!s || s.startsWith("type ")) continue;
      const name = s.split(/\s+as\s+/).pop()!.trim();
      out.push({ name, module: m[3]!, range: [m.index!, m.index! + m[0].length] });
    }
  }
  return out;
}

const isClient = (src: string) => /^\s*(["'])use client\1/.test(src);

const clientFiles = [...listFiles("components"), ...listFiles("app")].filter((f) =>
  isClient(read(f)),
);

// ── Which actions re-render the caller ──────────────────────────────────────
// `revalidatePath`/`revalidateTag` anywhere in the request, or a cookie write
// (Next re-renders after either). Followed through same-file helpers
// (`revalidateBudget()` and friends) to a fixed point.
const RERENDER = /\b(revalidatePath|revalidateTag|setSessionCookie|clearSessionCookie)\s*\(|\bjar\.(set|delete)\s*\(/;

function rerenderingActions(module: string): Set<string> {
  const src = codeOnly(read(path.join("app/actions", `${module}.ts`)));
  const decl = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^export\s+const\s+(\w+)\s*=\s*async/gm;
  const starts = [...src.matchAll(decl)].map((m) => ({ name: (m[1] ?? m[2])!, at: m.index! }));
  const bodies = new Map<string, string>();
  starts.forEach((s, k) => bodies.set(s.name, src.slice(s.at, starts[k + 1]?.at ?? src.length)));
  const hits = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, body] of bodies) {
      if (hits.has(name)) continue;
      const own = body.slice(body.indexOf("{"));
      const viaHelper = [...hits].some((h) => new RegExp(`\\b${h}\\s*\\(`).test(own));
      if (RERENDER.test(own) || viaHelper) {
        hits.add(name);
        grew = true;
      }
    }
  }
  return hits;
}

const rerenderCache = new Map<string, Set<string>>();
const rerenders = (module: string, name: string) => {
  if (!rerenderCache.has(module)) rerenderCache.set(module, rerenderingActions(module));
  return rerenderCache.get(module)!.has(name);
};

describe("client calls to server actions", () => {
  it("finds the callers it is guarding (the scan itself works)", () => {
    const callers = clientFiles.filter((f) => actionImports(read(f)).length > 0);
    expect(callers.length).toBeGreaterThan(50);
    expect(rerenders("creative", "updateCreativeNotes")).toBe(true);
    expect(rerenders("budget", "saveBudgetMonth")).toBe(true); // via revalidateBudget()
    expect(rerenders("account", "setActiveAccount")).toBe(true);
    expect(rerenders("comments", "createComment")).toBe(false);
    expect(codeOnly('const a = "router.refresh()"; // router.refresh()')).not.toMatch(/refresh/);
    expect(codeOnly("const t = `x ${router.refresh()} y`;")).toMatch(/router\.refresh\(\)/);
  });

  it("every call to an imported action sits inside safeAction(…)", () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      const src = read(file);
      const imports = actionImports(src);
      if (imports.length === 0) continue;
      const code = codeOnly(src);
      const spans = safeActionSpans(code);
      for (const imp of imports) {
        for (const m of code.matchAll(new RegExp(`(?<![.\\w$])${imp.name}\\b`, "g"))) {
          const at = m.index!;
          if (at >= imp.range[0] && at < imp.range[1]) continue;
          if (/typeof\s+$/.test(code.slice(Math.max(0, at - 10), at))) continue;
          if (spans.some(([a, b]) => at > a && at < b)) continue;
          offenders.push(`${file}:${lineOf(src, at)} ${imp.name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no router.refresh() in a file that calls an action which already re-renders", () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      const src = read(file);
      const imports = actionImports(src).filter((i) => rerenders(i.module, i.name));
      if (imports.length === 0) continue;
      const code = codeOnly(src);
      for (const m of code.matchAll(/\brouter\.refresh\s*\(/g)) {
        offenders.push(
          `${file}:${lineOf(src, m.index!)} (after ${imports.map((i) => i.name).join(", ")})`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("a caller that navigates away gets ONE render — the navigation", () => {
  // These actions are only ever followed by a navigation (create → the new
  // page, delete → the list), so a revalidation would render a page the
  // person is leaving — for a delete, a page that no longer exists.
  it.each([
    ["creative", "createCreative"],
    ["creative", "deleteCreative"],
    ["creative-bulk", "commitBulkCreatives"],
    ["campaign", "createCampaign"],
    ["campaign", "deleteCampaign"],
    ["store-upload", "commitStoreUpload"],
  ])("%s.%s does not revalidate", (module, name) => {
    expect(rerenders(module, name)).toBe(false);
  });

  // A rename follows the new URL; a revalidation would re-render the OLD one,
  // which now 404s. Both skip it exactly when the name changed.
  it.each([
    ["creative", "patchCreative", "newName !== oldRow.name"],
    ["campaign", "updateCampaign", "name !== current.name"],
  ])("%s.%s revalidates only when the name did not change", (module, name, guard) => {
    const src = codeOnly(read(`app/actions/${module}.ts`));
    const start = src.indexOf(`export async function ${name}(`);
    const next = src.indexOf("\nexport ", start + 10);
    const body = src.slice(start, next === -1 ? undefined : next);
    expect(body).toContain(`const renamed = ${guard};`);
    // Every revalidation in the action sits inside the `if (!renamed)` block.
    const guarded = body.slice(body.indexOf("if (!renamed) {"));
    const block = guarded.slice(0, guarded.indexOf("\n    }\n") + 6);
    const all = body.match(/\brevalidatePath\s*\(/g) ?? [];
    const inside = block.match(/\brevalidatePath\s*\(/g) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(inside.length).toBe(all.length);
  });
});

describe("preference writes are write-through, like the remembered filters", () => {
  // The URL the person is on already says what they picked; the preference is
  // for the NEXT bare visit, which reads it fresh (every page is dynamic).
  it.each(["setPreferredRange", "setIncludeExcludedPref", "setToastScope"])(
    "%s does not re-render the caller",
    (name) => {
      expect(rerenders("user-prefs", name)).toBe(false);
    },
  );

  it("the date picker does not refresh after remembering a pick", () => {
    expect(codeOnly(read("components/filters/date-range-picker.tsx"))).not.toMatch(
      /router\.refresh\s*\(/,
    );
  });

  it("the brand switcher does not refresh after setActiveAccount re-rendered", () => {
    expect(codeOnly(read("components/layout/account-switcher.tsx"))).not.toMatch(
      /router\.refresh\s*\(/,
    );
  });
});
