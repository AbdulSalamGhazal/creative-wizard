import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * PRESENTATION-ONLY PARAMS ARE SHALLOW (D12, 2026-10). A sort or a column
 * toggle re-arranges rows the client already holds; it used to be a full
 * server render each time (the Ads table: 15 queries and ~2 KB per creative
 * per click). These pin that the writers go through the native history API
 * (`lib/shallow-url.ts`) and that the order comes from the shared pure
 * comparators the server sorts with — so a click and a fresh load agree.
 */
const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const code = (f: string) => read(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("shallow sort and column writes", () => {
  it("Ads: sort and columns never navigate through the router", () => {
    const src = code("components/summary/summary-table.tsx");
    expect(src).not.toMatch(/router\.(replace|push)\(/);
    expect(src).toMatch(/shallowHref\(href, "push"\)/);
    expect(src).toMatch(/shallowParams\(\(params\) => writeAdsColumnParams/);
    expect(src).toMatch(/sortSummaryRows\(/);
  });

  it("the Ads server sorts with the same function", () => {
    expect(code("db/queries/summary.ts")).toMatch(/sortSummaryRows\(filteredRows, resolved, config\)/);
  });

  it("Library: the header and the Sort menu write the sort shallowly; table and grid re-sort", () => {
    expect(code("components/creative/creative-table.tsx")).toMatch(/writeLibrarySort\(/);
    expect(code("components/creative/creative-table.tsx")).not.toMatch(/router\.replace\(/);
    expect(code("components/creative/library-filter-bar.tsx")).toMatch(/setSort = \(s: CreativeSort\) => writeLibrarySort\(s\)/);
    expect(code("components/creative/creative-grid.tsx")).toMatch(/useLibrarySort\(/);
    expect(code("db/queries/creatives.ts")).toMatch(/sortCreativeRows\(mapped, filters\.sort\)/);
  });

  it("Campaigns: a sort click is a shallow push", () => {
    const src = code("components/portfolio/portfolio-table.tsx");
    expect(src).toMatch(/onSort=\{\(key, d\) =>\s*shallowParams\(/);
  });
});
