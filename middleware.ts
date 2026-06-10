import { NextResponse, type NextRequest } from "next/server";
import { activePresetKey, DATE_RANGE_COOKIE, todayIso } from "@/lib/date-presets";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Pages whose date range must NOT become the global remembered default.
// (Compare owns a special two-side range; Cleanup uses local state, no URL.)
const EXCLUDED = new Set(["/compare"]);

/**
 * Remember the user's date range — server-side and deterministically.
 *
 * Whenever a page is requested with a valid `from`/`to` in the URL (i.e. the
 * user just picked a range), we persist it to the `ccms_date_range` cookie on
 * that same response. Doing this in middleware — rather than via document.cookie
 * or a fire-and-forget server action in the browser — means it can't be dropped
 * by a navigation or a stale client cache. Stored as a ROLLING preset key when
 * the range matches a preset for today, else the exact `custom:FROM..TO` dates.
 * Pages with no `from`/`to` read this cookie as their default (lib/date-range-cookie).
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (EXCLUDED.has(req.nextUrl.pathname)) return res;

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (from && to && ISO.test(from) && ISO.test(to) && from <= to) {
    const value = activePresetKey(from, to) ?? `custom:${from}..${to}`;
    res.cookies.set(DATE_RANGE_COOKIE, value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE,
    });
  }
  return res;
}

export const config = {
  // Run on app pages; skip API routes, Next internals, and the favicon.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
