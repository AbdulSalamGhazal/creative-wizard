import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * THE BRAND IS IN THE URL (2026-11, lib/brand-path.ts): every link, router
 * call, redirect, API call and shallow URL write must stay in the tab's
 * brand. One bare `next/link` or `router.push("/library")` would send a tab
 * to whichever brand the browser touched last — the cross-tab bug this
 * change exists to end. So the Next primitives are reached only through the
 * brand-aware wrappers.
 */
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path.relative(ROOT, p));
  }
  return out;
}
const FILES = ["app", "components", "lib"].flatMap((d) => walk(path.join(ROOT, d)));
const src = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

function offenders(re: RegExp, allowed: string[]): string[] {
  return FILES.filter((f) => !allowed.includes(f) && re.test(src(f)));
}

describe("navigation stays in the tab's brand", () => {
  it("links come from @/components/nav/link, never next/link", () => {
    expect(offenders(/from "next\/link"/, ["components/nav/link.tsx"])).toEqual([]);
  });

  it("useRouter / usePathname come from @/lib/brand-nav", () => {
    expect(
      offenders(/import\s*\{[^}]*\b(useRouter|usePathname)\b[^}]*\}\s*from "next\/navigation"/, [
        "lib/brand-nav.ts",
      ]),
    ).toEqual([]);
  });

  it("a dashboard page redirects through brandRedirect", () => {
    const pages = FILES.filter((f) => f.startsWith("app/[brand]/") && !f.endsWith("layout.tsx"));
    expect(
      pages.filter((f) => /import\s*\{[^}]*\b(redirect|permanentRedirect)\b[^}]*\}\s*from "next\/navigation"/.test(src(f))),
    ).toEqual([]);
  });

  it("an /api call goes through brandFetch (a user-scoped one is named here)", () => {
    expect(offenders(/(?<![\w.])fetch\(\s*['"`]\/api\//, ["lib/avatar-upload.ts"])).toEqual([]);
  });

  it("history writes go through shallowHref, or keep the address bar's own path", () => {
    expect(
      offenders(/history\.(push|replace)State/, [
        "lib/shallow-url.ts",
        // These rewrite window.location's OWN pathname (already branded).
        "components/comments/comment-drawer.tsx",
        "components/user/team-directory.tsx",
      ]),
    ).toEqual([]);
  });
});
