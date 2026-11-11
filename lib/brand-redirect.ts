import { permanentRedirect, redirect } from "next/navigation";
import { withBrand } from "@/lib/brand-path";
import { getActiveAccount, requestedBrandSlug } from "@/lib/tenant";

/**
 * Next's `redirect()`, put under the request's brand (2026-11 — the brand is
 * in the URL, lib/brand-path.ts). A dashboard page that redirects to
 * `/library` lands on `/urjwan/library` when it was itself served under
 * `/urjwan/…`. Async because the brand comes from the request headers:
 * write `return brandRedirect(…)` (or `await`) so control flow still ends
 * there.
 */
export async function brandRedirect(href: string): Promise<never> {
  const slug = (await requestedBrandSlug()) ?? (await getActiveAccount()).slug;
  redirect(withBrand(slug, href));
}

/** `permanentRedirect()` (308), put under the request's brand — for a moved
 *  page whose old address bookmarks still name. */
export async function brandPermanentRedirect(href: string): Promise<never> {
  const slug = (await requestedBrandSlug()) ?? (await getActiveAccount()).slug;
  permanentRedirect(withBrand(slug, href));
}
