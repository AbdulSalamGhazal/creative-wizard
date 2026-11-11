"use client";

import { useEffect } from "react";
import { LAST_BRAND_COOKIE } from "@/lib/brand-path";

/**
 * Remember the brand this tab is on as the browser's "last brand" (2026-11):
 * where an old bookmark or the bare domain lands next time. Written by the
 * PAGE, not the middleware, so only a brand the person could actually open
 * is ever remembered. Never read as authority — every request is checked.
 */
export function RememberBrand({ slug }: { slug: string }) {
  useEffect(() => {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LAST_BRAND_COOKIE}=${encodeURIComponent(slug)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    // A tab coming back to the front makes ITS brand the last one again.
    const onFocus = () => {
      document.cookie = `${LAST_BRAND_COOKIE}=${encodeURIComponent(slug)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [slug]);
  return null;
}
