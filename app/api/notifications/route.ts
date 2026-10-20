import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { bellNotifications, unreadCount } from "@/db/queries/notifications";
import { categoryForType, safeHref } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications — the bell's feed: the unread count, EVERY unread
 * item up to `BELL_UNREAD_CAP` and the newest read ones to fill (see
 * `bellNotifications`), for the SESSION user in the ACTIVE brand.
 *
 * Behind `middleware.ts` like every other `/api` route (only `/api/health` and
 * `/api/mcp` are excluded), and `auth()` is re-checked here rather than
 * trusted from the cookie alone. The queries are self-scoping, so there is no
 * id in this request at all — nothing to tamper with.
 *
 * The response is deliberately minimal: it is polled. It carries `type`
 * alongside the derived category because the ARRIVAL TOASTER needs both to
 * decide whether an item is personal (a DIRECT event is personal but its
 * category is "system"), and hrefs are `safeHref`'d HERE so a stored link can
 * never reach a client as something navigable that isn't an in-app path.
 */
export async function GET() {
  const user = await auth();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [count, recent] = await Promise.all([unreadCount(), bellNotifications()]);

  return NextResponse.json(
    {
      count,
      items: recent.map((n) => ({
        id: n.id,
        type: n.type,
        category: categoryForType(n.type),
        title: n.title,
        // The comment it's about, as a 1–2 line preview in the bell (2026-10-20).
        body: n.body,
        href: safeHref(n.href),
        actor: n.actorName,
        actorAvatarUrl: n.actorAvatarUrl,
        createdAt: n.createdAt,
        read: n.readAt !== null,
      })),
    },
    // A polled, per-user response — never cached by anything in between.
    { headers: { "Cache-Control": "no-store" } },
  );
}
