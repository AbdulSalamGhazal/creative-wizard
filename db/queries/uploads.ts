import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { uploadBatches, users } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";

/** One row of the ads upload history (`/uploads`). */
export interface UploadBatchRow {
  id: string;
  platform: string;
  fileName: string;
  uploadedAt: Date;
  rowsImported: number;
  status: string;
  uploaderName: string;
  rolledBackAt: Date | null;
  /** Who rolled it back — a PK join off `rolled_back_by_user_id`. */
  rolledBackByName: string | null;
}

const rollbacker = alias(users, "rollbacker");

/**
 * The active brand's most recent ads upload batches, newest first (W3-8: the
 * page used to query them inline). Reads `limit + 1` so the page can say
 * "latest N" honestly when there are more, without a second count query.
 */
export async function listUploadBatches(
  limit = 50,
): Promise<{ rows: UploadBatchRow[]; capped: boolean }> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: uploadBatches.id,
      platform: uploadBatches.platform,
      fileName: uploadBatches.fileName,
      uploadedAt: uploadBatches.uploadedAt,
      rowsImported: uploadBatches.rowsImported,
      status: uploadBatches.status,
      uploaderName: users.name,
      rolledBackAt: uploadBatches.rolledBackAt,
      rolledBackByName: rollbacker.name,
    })
    .from(uploadBatches)
    .innerJoin(users, eq(users.id, uploadBatches.uploadedByUserId))
    .leftJoin(rollbacker, eq(rollbacker.id, uploadBatches.rolledBackByUserId))
    .where(eq(uploadBatches.accountId, acct))
    .orderBy(desc(uploadBatches.uploadedAt))
    .limit(limit + 1);
  return { rows: rows.slice(0, limit), capped: rows.length > limit };
}
