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
