import { createHash } from "node:crypto";
import { timingSafeEqualHex } from "@/lib/crypto";
import { syncAllStores } from "@/lib/connector/sync";

/**
 * The nightly catch-up pull (vercel.json `crons`, 01:00 UTC = 04:00 Riyadh).
 * Webhook retries stop after about five and a half hours and any `4xx` drops
 * a batch, so the webhook alone would lose orders; this pull asks the
 * connector for everything changed since the last run.
 *
 * Public to the cookie gate; Vercel Cron authenticates with
 * `Authorization: Bearer <CRON_SECRET>`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Leave room to record the outcome before the function is killed. */
const TIME_BUDGET_MS = 50_000;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  const given = req.headers.get("authorization") ?? "";
  // Hash both sides so the comparison is constant-time at any length.
  if (!timingSafeEqualHex(sha(given), sha(`Bearer ${secret}`))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const stores = await syncAllStores({ deadlineMs: Date.now() + TIME_BUDGET_MS });
  const ok = stores.every((s) => s.ok);
  return Response.json({ ok, stores }, { status: ok ? 200 : 500 });
}
