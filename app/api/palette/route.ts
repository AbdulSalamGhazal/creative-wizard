import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listCreativeOptions } from "@/db/queries/creatives";

export const dynamic = "force-dynamic";

/**
 * GET /api/palette — the ⌘K palette's creative list for the active brand
 * (D13, 2026-10). It used to be queried by the dashboard layout and shipped
 * with every full render (~85 B per creative, up to 500); the palette now
 * fetches it when it is first opened, or when the browser goes idle, and
 * refreshes it in the background on each later open.
 *
 * Behind `middleware.ts` like every `/api` route; `auth()` is re-checked here
 * and the read is account-scoped in the query layer. Names, products and ids
 * only — what the palette already showed.
 */
export async function GET() {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const creatives = await listCreativeOptions({ limit: 500 });
  return NextResponse.json({ creatives }, { headers: { "Cache-Control": "no-store" } });
}
