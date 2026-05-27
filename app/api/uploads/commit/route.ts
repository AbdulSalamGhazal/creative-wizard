import { NextResponse } from "next/server";

// POST /api/uploads/commit
// Body: { token }. Looks up the validated rows in KV, inserts an
// upload_batches row + bulk-inserts performance_records in one transaction,
// deletes the KV token. See docs/tech-spec.md §7.1.
export async function POST() {
  return NextResponse.json({ ok: false, error: "not implemented" }, { status: 501 });
}
