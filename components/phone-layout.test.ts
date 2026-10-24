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

describe("crowded rows (W3 walk)", () => {
  it("the strip's desktop row wraps, and its trailing pills never break a label", () => {
    expect(read("components/filters/filter-strip.tsx")).toContain(
      "hidden lg:flex flex-wrap items-center gap-2 px-6 py-2 min-h-12",
    );
    const pill = read("components/filters/filter-pill.tsx");
    expect(pill.match(/shrink-0 whitespace-nowrap/g)?.length).toBe(2); // Clear + Excluded
  });

  it("the audit chip stays on one line; the upload file name caps at 16rem", () => {
    expect(read("components/audit/audit-feed.tsx")).toMatch(/inline-flex shrink-0[^"`]*whitespace-nowrap/);
    expect(read("components/upload/batch-history-table.tsx")).toContain("sm:max-w-[16rem]");
  });
});
