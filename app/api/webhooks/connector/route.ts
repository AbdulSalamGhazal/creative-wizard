import { ingestConnectorEvents } from "@/lib/connector/ingest";
import { verifyConnectorSignature } from "@/lib/connector/verify";
import { connectorBatchSchema } from "@/validators/connector";

/**
 * Where the Urjwan Connector POSTs order events (batches of up to 100, about
 * every two minutes). PUBLIC to the cookie gate (see the middleware matcher)
 * and authenticated by its own HMAC signature instead.
 *
 * The status codes are the contract with the connector's retry logic:
 * - `200` — the batch is stored; never sent again.
 * - `401` — bad or stale signature. The connector DROPS the batch, which is
 *   right: nothing we could do with it later either.
 * - `503` / `500` — our side isn't ready (no secret configured, the database
 *   failed). The connector retries for about five and a half hours.
 * A batch whose JSON we can't read is also a `500`, not a `4xx`: a signed
 * batch we fail to parse is OUR bug, and a retry after the fix recovers it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CONNECTOR_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[connector] CONNECTOR_WEBHOOK_SECRET is not set");
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  // The signature covers the RAW bytes — read text, never req.json().
  const rawBody = await req.text();
  const ok = verifyConnectorSignature({
    rawBody,
    timestamp: req.headers.get("x-timestamp"),
    signature: req.headers.get("x-signature"),
    secret,
  });
  if (!ok) return Response.json({ error: "bad_signature" }, { status: 401 });

  try {
    const batch = connectorBatchSchema.parse(JSON.parse(rawBody));
    const result = await ingestConnectorEvents(batch.events, "webhook");
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[connector] webhook ingest failed:", err);
    return Response.json({ error: "ingest_failed" }, { status: 500 });
  }
}
