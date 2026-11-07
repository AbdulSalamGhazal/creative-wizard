import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { entityActivityPage, entityStatusEvents } from "@/db/queries/entity-activity";
import { entityActivityQuerySchema } from "@/validators/entity-activity";
import { auditLabel } from "@/lib/audit";
import { metaSummary } from "@/lib/audit-summary";
import type { EntityActivityRow } from "@/lib/entity-activity";

export const dynamic = "force-dynamic";

/**
 * GET /api/entity-activity?type=&id=[&before=] — an entity's Activity for the
 * panel's Activity face (2026-11-07): a page of the audit events that touched
 * it, newest first, and — on the FIRST page only — its derived went-live /
 * stopped events. Anyone who can open the entity's page sees it (user
 * decision): brand membership, enforced by the account scope in the query
 * layer. Read-only; behind `middleware.ts` like every `/api` route.
 */
export async function GET(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const parsed = entityActivityQuerySchema.safeParse({
    type: searchParams.get("type") ?? "",
    id: searchParams.get("id") ?? "",
    before: searchParams.get("before") || null,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid entity" }, { status: 400 });
  }
  const { type, id, before } = parsed.data;
  const [page, status] = await Promise.all([
    entityActivityPage(type, id, before),
    before === null ? entityStatusEvents(type, id) : Promise.resolve(null),
  ]);
  // Phrased HERE: the labels live beside the audit writer, which a client
  // bundle must never import. The panel renders strings.
  const rows: EntityActivityRow[] = page.rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    action: r.action,
    label: auditLabel(r.action),
    summary: metaSummary(r),
    // Named only when the event is about SOMETHING ELSE (an upload, a rule,
    // an angle) — "Updated creative · <this creative>" says nothing new.
    about:
      r.entityType === (type === "budget_month" ? "budget" : type) && (r.entityId === id || type === "budget_month")
        ? null
        : r.entityLabel,
    actor: r.actor ? { name: r.actor.name || r.actor.email, avatarUrl: r.actor.avatarUrl } : null,
  }));
  return NextResponse.json(
    { rows, hasMore: page.hasMore, status },
    { headers: { "Cache-Control": "no-store" } },
  );
}
