import { connectorOrdersPageSchema } from "@/validators/connector";

const DEFAULT_BASE_URL = "https://connector.urjwan.com";
const PAGE_LIMIT = 100;
const MAX_RETRIES = 3;
/** Never wait longer than this on one `Retry-After` — a cron run is 60 s. */
const MAX_WAIT_MS = 10_000;

export class ConnectorApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`connector ${status} ${code}`);
  }
}

function config() {
  const key = process.env.CONNECTOR_API_KEY;
  if (!key) throw new ConnectorApiError(0, "missing_api_key");
  const base = (process.env.CONNECTOR_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { key, base };
}

async function getJson(pathAndQuery: string): Promise<unknown> {
  const { key, base } = config();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}${pathAndQuery}`, {
      headers: { "X-App-Key": key, accept: "application/json" },
      cache: "no-store",
    });
    if (res.ok) return res.json();
    // Back off on rate limits and load shedding; anything else is final.
    if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000;
      await new Promise((r) => setTimeout(r, Math.min(wait, MAX_WAIT_MS)));
      continue;
    }
    let code = "http_error";
    try {
      const body = (await res.json()) as { error?: { code?: unknown } };
      if (typeof body?.error?.code === "string") code = body.error.code;
    } catch {
      // A non-JSON error body: the status is the whole story.
    }
    throw new ConnectorApiError(res.status, code);
  }
}

/**
 * Walk `GET /api/v1/orders` for one store, most recently changed first,
 * handing each page to `onPage`. Keeps paging while `next_cursor` is set —
 * a short page is not the end. Stops early (returning `complete: false`)
 * when `deadlineMs` passes, so a caller with a time limit can leave the
 * cursor where it was and let the next run repeat the idempotent work.
 * Returns the newest `updated_at` seen.
 */
export async function pullOrders(opts: {
  store: string;
  updatedSince?: string | null;
  createdFrom?: string;
  deadlineMs?: number;
  onPage: (orders: Record<string, unknown>[]) => Promise<void>;
}): Promise<{ complete: boolean; newestUpdatedAt: string | null; orders: number }> {
  let cursor: string | null = null;
  let newest: string | null = null;
  let newestMs = -Infinity;
  let orders = 0;
  for (;;) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
      return { complete: false, newestUpdatedAt: newest, orders };
    }
    const q = new URLSearchParams({ store: opts.store, limit: String(PAGE_LIMIT) });
    if (opts.updatedSince) q.set("updated_since", opts.updatedSince);
    if (opts.createdFrom) q.set("created_from", opts.createdFrom);
    if (cursor) q.set("cursor", cursor);
    const page = connectorOrdersPageSchema.parse(await getJson(`/api/v1/orders?${q}`));
    for (const o of page.data) {
      const u = typeof o.updated_at === "string" ? o.updated_at : null;
      const t = u ? Date.parse(u) : NaN;
      if (u && Number.isFinite(t) && t > newestMs) {
        newestMs = t;
        newest = u;
      }
    }
    orders += page.data.length;
    if (page.data.length > 0) await opts.onPage(page.data);
    cursor = page.next_cursor ?? null;
    if (!cursor) return { complete: true, newestUpdatedAt: newest, orders };
  }
}
