/**
 * `/favicon.ico` → the tab icon (`app/icon.png`).
 *
 * Browsers and link-preview crawlers ask for this path by habit, whatever the
 * page's `<link rel="icon">` says. There is no such file — the icon is the
 * `app/icon.png` file convention — and the middleware lets every root-level
 * `.ico` through ungated, so the request used to fall into `app/[brand]` with
 * "favicon.ico" as the brand: a whole dashboard render started for an icon,
 * and its page threw `NO_BRAND_ACCESS` into the log on every page load
 * (2026-11-20). A static route wins over the dynamic segment, so it ends here.
 *
 * Public and cookie-free, like the icon it points at.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(null, {
    status: 308,
    headers: {
      Location: "/icon.png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
