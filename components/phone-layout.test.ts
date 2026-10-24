import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * The 375px defects W3 measured (scrollWidth > 375) and fixed. These are
 * layout decisions a unit render can't measure, so they are pinned at the
 * source: a revert reintroduces a page that scrolls sideways on a phone.
 * The rule they follow lives in docs/decisions/ui-system.md.
 */
describe("phone layout (375px)", () => {
  it("a KPI tile's header stacks inside a narrow tile, and so does its skeleton", () => {
    expect(read("components/overview/metric-card.tsx")).toContain("@max-[12rem]:flex-col");
    expect(read("components/overview/dashboard-skeletons.tsx")).toContain("@max-[12rem]:flex-col");
  });

  it("a Badge carrying a sentence wraps instead of running past the frame", () => {
    for (const page of ["app/(dashboard)/page.tsx", "app/(dashboard)/trends/over-time/page.tsx"]) {
      expect(read(page), page).toMatch(/<Badge[\s\S]{0,80}h-auto max-w-full whitespace-normal/);
    }
  });

  it("the date popover shows one month below sm and never outgrows the viewport", () => {
    const src = read("components/filters/date-range-picker.tsx");
    expect(src).toContain("numberOfMonths={wide ? 2 : 1}");
    expect(src).toContain("max-w-[calc(100vw-1rem)]");
  });
});
