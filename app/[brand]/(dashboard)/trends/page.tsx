import { brandRedirect } from "@/lib/brand-redirect";

// Trends is no longer a landing page — it's a sidebar hub that expands to its
// sub-views. Any direct hit on /trends (bookmark, back-link, old link) lands on
// the first sub-view.
export default async function TrendsIndex() {
  return brandRedirect("/trends/over-time");
}
