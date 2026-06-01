import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Public liveness/readiness probe. Returns 200 when the app can reach the
 * database, 503 when it can't. Point a free uptime monitor (UptimeRobot,
 * BetterStack, etc.) at https://creative.urjwan.com/api/health so you hear
 * about an outage from the monitor, not from a user.
 *
 * No auth and no sensitive data — just a status + round-trip time.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const started = Date.now();
  try {
    // Hard cap so the probe itself can never hang, even if the DB is wedged.
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("health probe timeout")), 7000),
      ),
    ]);
    return Response.json(
      { status: "ok", db: "up", ms: Date.now() - started },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[health] db check failed:", err);
    return Response.json(
      { status: "degraded", db: "down", ms: Date.now() - started },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
