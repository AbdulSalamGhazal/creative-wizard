import { redirect } from "next/navigation";

// The "tag" concept was renamed "angle" (2026-09) — this route moved with it.
// Kept as a stub so existing bookmarks and shared links still land.
export default function ByTagRedirect() {
  redirect("/trends/by-angle");
}
