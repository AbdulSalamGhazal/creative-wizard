import { z } from "zod";

/**
 * The audit log's "Load older" cursor (`?before=<event id>`, R-117): the feed
 * shows events strictly older than it. Anything that isn't a positive integer
 * means "start at the newest".
 */
const beforeSchema = z.coerce.number().int().positive();

export function parseAuditBefore(raw: string | undefined): number | undefined {
  const r = beforeSchema.safeParse(raw);
  return r.success ? r.data : undefined;
}
