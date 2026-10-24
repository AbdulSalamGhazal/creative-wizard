import { describe, expect, it } from "vitest";
import {
  ROLLBACK_WINDOW_MS,
  batchStatusLabel,
  withinRollbackWindow,
} from "@/lib/upload-batches";

describe("upload batch facts (W3-3)", () => {
  it("the window is 24 h, inclusive, for a Date or an ISO string", () => {
    const now = Date.parse("2026-10-24T12:00:00Z");
    expect(ROLLBACK_WINDOW_MS).toBe(86_400_000);
    expect(withinRollbackWindow(new Date(now - ROLLBACK_WINDOW_MS), now)).toBe(true);
    expect(withinRollbackWindow(new Date(now - ROLLBACK_WINDOW_MS - 1), now)).toBe(false);
    expect(withinRollbackWindow("2026-10-24T00:00:00Z", now)).toBe(true);
  });
  it("a status is never shown as its stored identifier", () => {
    expect(batchStatusLabel("rolled_back")).toBe("rolled back");
    expect(batchStatusLabel("active")).toBe("active");
    expect(batchStatusLabel("some_future_state")).toBe("some future state");
  });
});
