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
  return value;
}
