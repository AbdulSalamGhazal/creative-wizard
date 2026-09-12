import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { recentNotifications, unreadCount } from "@/db/queries/notifications";
import { categoryForType } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications — the bell's feed: the unread count and the latest
 * few, for the SESSION user in the ACTIVE brand.
 *
 * Behind `middleware.ts` like every other `/api` route (only `/api/health` and
 * `/api/mcp` are excluded), and `auth()` is re-checked here rather than
 * trusted from the cookie alone. The queries are self-scoping, so there is no
 * id in this request at all — nothing to tamper with.
 *
 * The response is deliberately minimal: it is polled.
 */
export async function GET() {
  const user = await auth();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [count, recent] = await Promise.all([unreadCount(), recentNotifications()]);

  return NextResponse.json(
    {
      count,
      items: recent.map((n) => ({
        id: n.id,
        category: categoryForType(n.type),
        title: n.title,
        href: n.href,
        actor: n.actorName,
        createdAt: n.createdAt,
        read: n.readAt !== null,
      })),
    },
    // A polled, per-user response — never cached by anything in between.
    { headers: { "Cache-Control": "no-store" } },
  );
}
