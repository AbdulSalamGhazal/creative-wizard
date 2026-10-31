import { describe, expect, it } from "vitest";
import { photoBroken, showsPhoto } from "@/lib/avatar";

/**
 * UserAvatar's fallback (2026-11-01): a photo that 404s shows the initials,
 * never a broken image. The component's own state is these two decisions.
 */
describe("showsPhoto — a failure belongs to the src that failed", () => {
  it("shows a photo until THAT src fails", () => {
    expect(showsPhoto("/a.webp", null)).toBe(true);
    expect(showsPhoto("/a.webp", "/a.webp")).toBe(false);
  });

  it("a NEW src gets a fresh chance — no effect has to reset anything", () => {
    // The old `useEffect(() => setFailed(false), [src])` also ran on MOUNT,
    // undoing an error that had already fired, so the broken image stayed.
    expect(showsPhoto("/b.webp", "/a.webp")).toBe(true);
  });

  it("no src, no photo", () => {
    expect(showsPhoto(null, null)).toBe(false);
    expect(showsPhoto("", null)).toBe(false);
  });
});

describe("photoBroken — an error that fired before React was listening", () => {
  it("a finished load with no pixels is broken", () => {
    expect(photoBroken({ complete: true, naturalWidth: 0 })).toBe(true);
  });

  it("a loaded photo, or one still loading (lazy), is not", () => {
    expect(photoBroken({ complete: true, naturalWidth: 256 })).toBe(false);
    expect(photoBroken({ complete: false, naturalWidth: 0 })).toBe(false);
  });
});
