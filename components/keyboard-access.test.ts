import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Keyboard access the 2026-11-07 audit fixed, pinned so it can't quietly
 * regress (the component tests here run in node, without a DOM).
 */
const src = (rel: string) => readFileSync(rel, "utf8");

describe("keyboard access", () => {
  it("the comment composer's tools act on click, which Enter/Space fire (R-028)", () => {
    const body = src("components/comments/comment-composer.tsx").split("function ToolButton(")[1]!;
    expect(body).toContain("onClick={onClick}");
    // mousedown only keeps the textarea's selection — it never runs the tool.
    expect(body).toMatch(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
  });

  it("the segmented control is a radio group with one tab stop and arrow keys (R-024)", () => {
    const s = src("components/ui/segmented-control.tsx");
    expect(s).toContain('role="radiogroup"');
    expect(s).toContain('role="radio"');
    expect(s).toContain("aria-checked");
    expect(s).toContain("tabIndex={i === tabStop ? 0 : -1}");
    expect(s).toContain('"ArrowRight"');
    expect(s).not.toContain('role="tablist"');
  });

  it("the expanded chart is the house Dialog, not a hand-rolled overlay (R-020)", () => {
    const s = src("components/charts/chart-shell.tsx");
    expect(s).toContain("<DialogContent");
    expect(s).not.toContain('role="dialog"');
    expect(s).not.toContain('addEventListener("keydown"');
  });

  it("hover-only affordances use the one reveal recipe (R-002)", () => {
    for (const f of [
      "components/creative/thumbnail-upload.tsx",
      "components/summary/views-control.tsx",
      "components/ui/table-columns-control.tsx",
    ]) {
      expect(src(f), f).toContain("REVEAL_ON_HOVER");
    }
    expect(src("lib/utils.ts")).toContain("[@media(hover:none)]:opacity-100");
  });
});
