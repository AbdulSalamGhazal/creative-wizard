/**
 * Decode a dynamic route segment without ever throwing.
 *
 * `decodeURIComponent` throws a `URIError` on a malformed percent-escape — e.g.
 * a hand-typed or external URL like `/creatives/50%off` (a bare `%` not part of
 * a valid `%XX` sequence). In a Server Component that throw is unhandled and
 * surfaces as a 500 "Something went wrong" page. Falling back to the raw
 * segment turns it into a clean lookup miss → `notFound()` (a 404) at the call
 * site instead.
 *
 * Well-formed names are unaffected: every link in the app is built with
 * `encodeURIComponent`, so `#`, `?`, `&`, `"`, `%`, spaces, etc. all round-trip
 * back to the exact original string.
 */
export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Append an active `from`/`to` date range to a same-app destination path so the
 * range survives a cross-page navigation (a listing → its detail page). A no-op
 * unless BOTH ends are present — when a page relies on the saved-preference
 * range (no explicit URL params) the destination independently resolves that
 * same preference, so there is nothing to carry and nothing to append. Any
 * existing query string on `href` is preserved.
 */
export function withDateRange(
  href: string,
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  if (!from || !to) return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

/**
 * Constrain a user-supplied redirect target (the sign-in `?next=` param) to a
 * same-origin path. Only a value starting with a single "/" passes:
 * "//evil.com" is protocol-relative and "https://evil.com" is absolute — a
 * crafted /signin?next=//evil.com link must not bounce a signed-in user
 * off-site. "/\" is rejected too (browsers normalize backslash to "/",
 * turning it protocol-relative). Used on BOTH the server redirect and the
 * client router.replace, so neither side trusts the other.
 */
export function safeInternalPath(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (!value || !value.startsWith("/")) return fallback;
  const second = value.charAt(1);
  if (second === "/" || second === "\\") return fallback;
  // Reject ASCII control chars: browsers STRIP tabs/newlines from a URL before
  // navigating, so "/\t/evil.com" (which "/%09/evil.com" decodes to) re-forms
  // as "//evil.com" — protocol-relative and off-site.
  if (/[\x00-\x1f]/.test(value)) return fallback;
  return value;
}
