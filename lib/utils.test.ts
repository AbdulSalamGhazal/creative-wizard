import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn keeps the house micro-label sizes (R-051)", () => {
  it("text-label / text-eyebrow survive a text colour", () => {
    expect(cn("text-label text-ink-3")).toBe("text-label text-ink-3");
    expect(cn("text-eyebrow", "text-brand")).toBe("text-eyebrow text-brand");
  });
  it("they still conflict with another size, last one wins", () => {
    expect(cn("text-label", "text-xs")).toBe("text-xs");
  });
});
