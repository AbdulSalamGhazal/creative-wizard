import { brandRedirect } from "@/lib/brand-redirect";

// The "tag" concept was renamed "angle" (2026-09) — this route moved with it.
// Kept as a stub so existing bookmarks and shared links still land.
export default async function ByTagRedirect() {
  return brandRedirect("/trends/by-angle");
}
