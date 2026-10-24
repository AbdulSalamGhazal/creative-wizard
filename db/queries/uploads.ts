import { desc, eq } from "drizzle-orm";
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
}

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
    })
    .from(uploadBatches)
    .innerJoin(users, eq(users.id, uploadBatches.uploadedByUserId))
    .where(eq(uploadBatches.accountId, acct))
    .orderBy(desc(uploadBatches.uploadedAt))
    .limit(limit + 1);
  return { rows: rows.slice(0, limit), capped: rows.length > limit };
}
