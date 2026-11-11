"use client";

import { useMemo } from "react";
import {
  usePathname as useNextPathname,
  useRouter as useNextRouter,
} from "next/navigation";
import { BRAND_HEADER, splitBrandPath, stripBrand, withBrand } from "@/lib/brand-path";

/**
 * The brand-aware stand-ins for `next/navigation`'s `useRouter` and
 * `usePathname` (2026-11 — the brand is in the URL, lib/brand-path.ts). Same
 * names and shapes, so a call site reads exactly as before:
 *
 *  - `usePathname()` is the APP path — `/library/x`, never `/urjwan/library/x`
 *    — so every rule that matches a page keeps matching it;
 *  - `useRouter().push("/library")` goes to `/urjwan/library` in THIS tab's
 *    brand; an already-branded href (another brand) passes untouched.
 *
 * `app/brand-nav.test.ts` fails the build on a direct import of the Next
 * versions, `next/link` (use `@/components/nav/link`) or Next's `redirect`
 * in a dashboard page (use `brandRedirect`).
 */

/** This tab's brand slug, read from the route's own (branded) pathname. */
export function useBrandSlug(): string | null {
  return splitBrandPath(useNextPathname() ?? "/").slug;
}

export function usePathname(): string {
  return stripBrand(useNextPathname() ?? "/");
}

export function useRouter(): ReturnType<typeof useNextRouter> {
  const router = useNextRouter();
  const slug = useBrandSlug();
  return useMemo(
    () => ({
      ...router,
      push: (href, options) => router.push(withBrand(slug, href), options),
      replace: (href, options) => router.replace(withBrand(slug, href), options),
      prefetch: (href, options) => router.prefetch(withBrand(slug, href), options),
    }),
    [router, slug],
  );
}

/** The CURRENT tab's brand, read from the address bar (event handlers). */
export function currentBrandSlug(): string | null {
  return typeof window === "undefined" ? null : splitBrandPath(window.location.pathname).slug;
}

/** `window.location.pathname` without its brand (event handlers). */
export function currentAppPathname(): string {
  return typeof window === "undefined" ? "/" : stripBrand(window.location.pathname);
}

/** Put an app path under the CURRENT tab's brand (event handlers). */
export function brandHref(href: string): string {
  return withBrand(currentBrandSlug(), href);
}

/**
 * `fetch` for this app's `/api/*`: carries the tab's brand in the
 * `x-ccms-brand` header, so the API answers for the brand the tab SHOWS — not
 * the last one this browser touched. (Membership is checked server-side.)
 */
export function brandFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const slug = currentBrandSlug();
  if (!slug) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.set(BRAND_HEADER, slug);
  return fetch(input, { ...init, headers });
}
