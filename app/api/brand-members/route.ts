import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { brandMembers } from "@/db/queries/notifications";

export const dynamic = "force-dynamic";

/**
 * GET /api/brand-members — the mention picker's list: everyone who can see the
 * active brand (so a mention can never point at someone who couldn't open the
 * thing being discussed).
 *
 * Fetched lazily, the first time a picker opens, so no page pays for it up
 * front. Behind `middleware.ts`; names and ids only.
 */
export async function GET() {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const members = await brandMembers();
  return NextResponse.json(
    { members: members.map((m) => ({ id: m.id, name: m.name })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
