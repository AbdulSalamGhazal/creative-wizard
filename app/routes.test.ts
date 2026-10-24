import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * RULES-CENSUS GUARD (2026-10) — two UI rules promoted from prose to a test.
 *
 * CLAUDE.md has said "every route ships a tailored `loading.tsx`" and "every
 * new route sets a `metadata.title`" since the consistency pass. Both were
 * followed by discipline alone, which works right up until the day somebody
 * adds a route in a hurry — and a missing skeleton or a missing tab title is
 * invisible in review and in every other test we run.
 *
 * A REDIRECT STUB is not a route in this sense: it renders nothing, so a
 * skeleton would flash and a title would never be read. Stubs are detected by
 * shape (a page that calls `redirect()` and renders no JSX at all), not by a
 * list, so retiring one needs no bookkeeping here.
 *
 * The shape used to be "a file under 32 lines that contains `redirect(`" —
 * which also matched four real FORM routes that redirect only when the
 * reader lacks the permission (`/campaigns/new`, `/library/new`,
 * `/library/bulk`, `/uploads/new`), so they shipped no skeleton with this
 * test green (W3-9). A page that renders a component is a route.
 */

const ROOT = process.cwd();

/** Every `page.tsx` under `app/`, repo-relative. (The house walk — `globSync`
 *  is still experimental in node and warns on every run.) */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry === "page.tsx") out.push(path.relative(ROOT, p));
  }
  return out;
}
const pages = walk(path.join(ROOT, "app")).sort();

/** A page that exists only to send you somewhere else: it redirects and
 *  renders nothing (no JSX element anywhere in the file). */
export function isRedirectStub(src: string): boolean {
  const redirects = /\b(?:permanentRedirect|redirect)\(/.test(src);
  const rendersJsx = /<[A-Za-z][\w.]*[\s/>]/.test(
    // Generic type arguments (`Promise<Record<…>>`) are not JSX.
    src.replace(/\b[A-Z]\w*<[^>()]*>+/g, ""),
  );
  return redirects && !rendersJsx;
}

/**
 * Real pages that deliberately ship no `loading.tsx`. Each line is a decision;
 * adding one should need an argument, not a shrug.
 */
const NO_LOADING_OK: Record<string, string> = {
  "app/(auth)/oauth/consent/page.tsx":
    "the OAuth consent screen renders from the session alone — there is no query to wait on, and a skeleton would flash between two instant states",
  "app/(auth)/signin/page.tsx":
    "the sign-in form renders after one session check (signed in → redirect) — no data to wait on, and a skeleton would flash before an instant form",
};

describe("every route carries its own chrome", () => {
  it("…ships a tailored loading.tsx, or is a redirect stub, or is exempted", () => {
    const missing: string[] = [];
    for (const p of pages) {
      const src = readFileSync(path.join(ROOT, p), "utf8");
      if (isRedirectStub(src)) continue;
      if (p in NO_LOADING_OK) continue;
      if (!existsSync(path.join(ROOT, path.dirname(p), "loading.tsx"))) missing.push(p);
    }
    expect(missing, "add a loading.tsx mirroring the page's shape, or exempt it with a reason").toEqual([]);
  });

  it("…sets a metadata.title (or generateMetadata)", () => {
    const missing: string[] = [];
    for (const p of pages) {
      const src = readFileSync(path.join(ROOT, p), "utf8");
      if (isRedirectStub(src)) continue;
      if (!/export (const metadata|async function generateMetadata)/.test(src)) missing.push(p);
    }
    expect(missing, "the tab title is part of the route — set metadata or generateMetadata").toEqual([]);
  });

  it("every exemption still exists and still has a reason", () => {
    // A stale exemption is how a list like this rots into permission to skip.
    for (const [p, why] of Object.entries(NO_LOADING_OK)) {
      expect(existsSync(path.join(ROOT, p)), `${p} is exempt but is gone`).toBe(true);
      expect(why.length).toBeGreaterThan(40);
    }
  });
});

describe("the stub detector", () => {
  it("a page that redirects and renders nothing is a stub", () => {
    expect(
      isRedirectStub(
        'import { redirect } from "next/navigation";\nexport default function X() {\n  redirect("/a");\n}\n',
      ),
    ).toBe(true);
    expect(
      isRedirectStub(
        "export default async function X({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {\n  permanentRedirect(\"/b\");\n}\n",
      ),
    ).toBe(true);
  });
  it("a form route that redirects only without the permission is NOT a stub", () => {
    for (const p of [
      "app/(dashboard)/campaigns/new/page.tsx",
      "app/(dashboard)/library/new/page.tsx",
      "app/(dashboard)/library/bulk/page.tsx",
      "app/(dashboard)/uploads/new/page.tsx",
    ]) {
      expect(isRedirectStub(readFileSync(path.join(ROOT, p), "utf8")), p).toBe(false);
    }
  });
});
