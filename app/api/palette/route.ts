import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listCreativeOptions } from "@/db/queries/creatives";
import { listPaletteCampaigns } from "@/db/queries/campaign";
import { listSavedViewOptions } from "@/db/queries/summary-views";

export const dynamic = "force-dynamic";

/**
 * GET /api/palette — the ⌘K palette's entity lists for the active brand
 * (D13, 2026-10). It used to be queried by the dashboard layout and shipped
 * with every full render (~85 B per creative, up to 500); the palette now
 * fetches it when it is first opened, or when the browser goes idle, and
 * refreshes it in the background on each later open.
 *
 * Creatives, campaigns (2026-11-07, R-027: name + platform from the registry)
 * and the caller's OWN saved views (views are private). Behind
 * `middleware.ts` like every `/api` route; `auth()` is re-checked here and
 * every read is account-scoped in the query layer.
 */
export async function GET() {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [creatives, campaigns, views] = await Promise.all([
    listCreativeOptions({ limit: 500 }),
    listPaletteCampaigns(500),
    listSavedViewOptions(user.id),
  ]);
  return NextResponse.json(
    { creatives, campaigns, views },
    { headers: { "Cache-Control": "no-store" } },
  );
}
