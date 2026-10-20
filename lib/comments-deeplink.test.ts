import { describe, expect, it } from "vitest";
import * as comments from "@/lib/comments";
import { viewQuerySchema } from "@/validators/comments";

/**
 * A6 + A7 (2026-10) — a notification link lost its comment, and the link's
 * `?comment=` leaked into the next comment's saved view.
 */

const ID = "9b2f1c3e-0000-4000-8000-000000000001";

describe("A6 — the deep-linked comment survives until its thread is on screen", () => {
  const step = (
    deepLinkId: string | null,
    loadedIds: string[] | null,
    reloadedFor: string | null = null,
  ) => comments.deepLinkStep({ deepLinkId, loadedIds, reloadedFor });

  it("waits while nothing is loaded — the panel mounting is not a reason to drop it", () => {
    expect(step(ID, null)).toEqual({ kind: "wait" });
  });

  it("highlights it the moment a loaded thread contains it", () => {
    expect(step(ID, ["a", ID, "b"])).toEqual({ kind: "highlight", id: ID });
  });

  it("reloads ONCE when the thread on screen doesn't have it (it may be newer than the load)", () => {
    expect(step(ID, ["a"])).toEqual({ kind: "reload" });
    expect(step(ID, ["a"], ID)).toEqual({ kind: "wait" });
  });

  it("does nothing without a deep link", () => {
    expect(step(null, ["a"])).toEqual({ kind: "wait" });
  });
});

describe("A7 — `?comment=` is navigation, never part of a saved view", () => {
  it("is stripped when the view is captured, and everything else is kept verbatim", () => {
    expect(comments.stripCommentParam(`?from=2026-01-01&comment=${ID}&platforms=tiktok,meta`)).toBe(
      "from=2026-01-01&platforms=tiktok,meta",
    );
    expect(comments.stripCommentParam(`comment=${ID}`)).toBe("");
    expect(comments.stripCommentParam("")).toBe("");
  });

  it("never makes two views differ, so the chip doesn't offer a 'view' that is only a deep link", () => {
    expect(comments.normalizeQuery(`a=1&comment=${ID}`)).toBe("a=1");
    expect(comments.showViewChip("a=1", `a=1&comment=${ID}`)).toBe(false);
    expect(comments.showViewChip(`comment=${ID}`, "")).toBe(false);
  });

  it("the server strips it too — a stale client can't store it", () => {
    expect(viewQuerySchema.parse(`?from=2026-01-01&comment=${ID}`)).toBe("from=2026-01-01");
  });

  it("a deep link built from an OLD comment that stored it points at the RIGHT comment", () => {
    const target = comments.buildCommentTarget("/summary", `from=2026-01-01&comment=old`, ID)!;
    expect(new URL(target, "http://x").searchParams.getAll("comment")).toEqual([ID]);
  });
});
