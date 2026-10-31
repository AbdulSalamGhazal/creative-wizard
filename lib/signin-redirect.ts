/**
 * The way back through sign-in, built in ONE place for both gates (2026-11-01).
 *
 * The middleware verifies the cookie's signature and TTL only; the dashboard
 * layout then rejects a verified cookie whose user is gone or whose sessions
 * were ended. The middleware's own redirect kept `?next=`, the layout's
 * dropped it. So the middleware stamps the path it served on the forwarded
 * request (overwriting anything the client sent), and the layout reads it
 * back. The sign-in page constrains `next` to a same-origin path
 * (`safeInternalPath`), as it does for every other caller.
 *
 * Edge-safe: no imports — the middleware runs on the Edge runtime.
 */

/** The request header the middleware stamps with the served path + query. */
export const REQUEST_PATH_HEADER = "x-ccms-path";

/** `/signin`, or `/signin?next=<path>` when there is somewhere to come back to. */
export function signinHref(path: string | null | undefined): string {
  if (!path || path === "/") return "/signin";
  return `/signin?next=${encodeURIComponent(path)}`;
}
