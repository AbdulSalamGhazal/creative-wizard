import { NextResponse } from "next/server";

// POST /api/uploads/validate
// Accepts multipart/form-data with `file` and `platform`. Runs the 5-stage
// pipeline; on success returns { token, summary, warnings }; on failure
// returns the full error array. No DB writes here.
// See docs/tech-spec.md §7.1.
export async function POST() {
  return NextResponse.json({ ok: false, error: "not implemented" }, { status: 501 });
}
