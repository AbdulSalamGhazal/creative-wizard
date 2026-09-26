import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { canvasFiltersSchema } from "@/validators/canvas";
import { creativeListFiltersSchema } from "@/validators/creative";
import { portfolioFiltersSchema } from "@/validators/portfolio";
import { reconciliationFiltersSchema, storeOrdersFiltersSchema } from "@/validators/store";
import {
  FILTERS_EXPLICIT_PARAM,
  VIEW_MARKER_PARAM,
  prefsSuppressed,
} from "@/validators/user-prefs";

/**
 * FilterShell phase 2 (2026-09): every filter-bearing page is on the shell.
 * The migrations are PRESENTATION ONLY — each page's URL params are unchanged,
 * and Clear still reaches nothing but that page's declared tier-2 filters.
 *
 * Two guards per page:
 *  1. the params round-trip — every param the bar writes still parses;
 *  2. a source-level check of the declared def keys — they must be that page's
 *     filter params, and never a protected one (sort, columns, the view, the
 *     date range, tier-1 state), because Clear can only reach what is declared.
 */

/** The `key: "…"` entries of a bar's FilterDef[] — its tier-2 declaration. */
function declaredKeys(file: string): string[] {
  const src = readFileSync(file, "utf8");
  // Def keys are indented inside the `filters` array literal.
  return [...src.matchAll(/^\s{6}key: "([^"]+)",$/gm)].map((m) => m[1]!);
}

/** Never clearable on any page — the shell must not be able to see these. */
const PROTECTED = [
  "sort",
  "dir",
  "view",
  "hide",
  "hideIdentity",
  "hideMetrics",
  "hideRate",
  "hideBlended",
  "from",
  "to",
  "q",
  "includeExcluded",
  "page",
  "groupBy",
];

const PAGES = {
  library: {
    file: "components/creative/library-filter-bar.tsx",
    defs: ["productIds", "types", "statuses", "angles", "priorities", "stages"],
  },
  campaigns: {
    file: "components/portfolio/portfolio-filter-bar.tsx",
    defs: ["objectives", "statuses"],
  },
  canvas: {
    file: "components/canvas/canvas-filter-bar.tsx",
    defs: ["statuses", "productIds", "stages"],
  },
  // Zero-def pages: the same bar with no Filters button and no chips row.
  storeOrders: { file: "components/store/store-filter-bar.tsx", defs: [] },
  reconciliation: { file: "components/store/reconciliation-view.tsx", defs: [] },
  pacing: { file: "components/budget/budget-pacing.tsx", defs: [] },
} as const;

describe("each migrated bar declares exactly its tier-2 filters", () => {
  for (const [page, { file, defs }] of Object.entries(PAGES)) {
    it(`${page}: declares ${defs.length} filter(s)`, () => {
      expect(declaredKeys(file).sort()).toEqual([...defs].sort());
    });

    it(`${page}: declares no protected param, so Clear can't reach one`, () => {
      for (const key of PROTECTED) expect(declaredKeys(file)).not.toContain(key);
    });
  }

  it("the zero-def pages render no Filters button (filters={[]})", () => {
    for (const page of ["storeOrders", "reconciliation", "pacing"] as const) {
      expect(readFileSync(PAGES[page].file, "utf8")).toContain("filters={[]}");
    }
  });

  it("every migrated bar writes the URL through the batching hook ONLY", () => {
    for (const { file } of Object.values(PAGES)) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("useFilterParams");
      // No bar keeps its own router.replace — that is what used to make two
      // writes in a tick clobber each other.
      expect(src).not.toContain("router.replace");
    }
  });
});

describe("URL params are UNCHANGED — every param each bar writes still parses", () => {
  it("Library", () => {
    const f = creativeListFiltersSchema.parse(
      Object.fromEntries(
        new URLSearchParams(
          "q=hero&productIds=p1,p2&types=video,image&statuses=active,pause" +
            "&platforms=instagram,facebook&angles=ugc&priorities=3,unrated" +
            "&stages=Awareness,N/A&sort=spend7-desc&view=grid",
        ),
      ),
    );
    expect(f.q).toBe("hero");
    expect(f.productIds).toEqual(["p1", "p2"]);
    expect(f.types).toEqual(["video", "image"]);
    expect(f.statuses).toEqual(["active", "pause"]);
    expect(f.platforms).toEqual(["instagram", "facebook"]);
    expect(f.angles).toEqual(["ugc"]);
    expect(f.priorities).toEqual(["3", "unrated"]);
    expect(f.stages).toEqual(["Awareness", "N/A"]);
    expect(f.sort).toBe("spend7-desc"); // a toolbar control, untouched by Clear
    expect(f.view).toBe("grid");
  });

  it("Campaigns", () => {
    const f = portfolioFiltersSchema.parse(
      Object.fromEntries(
        new URLSearchParams(
          "from=2026-01-01&to=2026-01-31&q=launch&platforms=tiktok" +
            "&objectives=Sales&statuses=active&includeExcluded=1&sort=spend&hide=roas",
        ),
      ),
    );
    expect(f.from).toBe("2026-01-01");
    expect(f.to).toBe("2026-01-31");
    expect(f.q).toBe("launch");
    expect(f.platforms).toEqual(["tiktok"]);
    expect(f.objectives).toEqual(["Sales"]);
    expect(f.statuses).toEqual(["active"]);
    expect(f.includeExcluded).toBe(true);
    expect(f.sort).toBe("spend");
  });

  it("Campaigns: a view saved BEFORE the migration still applies", () => {
    const old = portfolioFiltersSchema.parse(
      Object.fromEntries(new URLSearchParams("platforms=instagram&sort=spend&dir=desc")),
    );
    expect(old.platforms).toEqual(["instagram"]);
    expect(old.objectives).toEqual([]);
    expect(old.statuses).toEqual([]);
    expect(old.q).toBeUndefined();
  });

  it("Canvas", () => {
    const f = canvasFiltersSchema.parse(
      Object.fromEntries(
        new URLSearchParams(
          "from=2026-02-01&to=2026-02-28&platforms=google&statuses=active,pause" +
            "&productIds=3f1e0a42-9c55-4c7e-8f3a-2b7a51d0c001&stages=Retargeting&view=campaign",
        ),
      ),
    );
    expect(f.platforms).toEqual(["google"]);
    expect(f.statuses).toEqual(["active", "pause"]);
    expect(f.productIds).toEqual(["3f1e0a42-9c55-4c7e-8f3a-2b7a51d0c001"]);
    expect(f.stages).toEqual(["Retargeting"]);
    expect(f.view).toBe("campaign"); // the canvas toolbar's own param, untouched
  });

  it("Store orders (zero-def: date + search only)", () => {
    const f = storeOrdersFiltersSchema.parse(
      Object.fromEntries(
        new URLSearchParams("from=2026-03-01&to=2026-03-31&q=ORD-9&page=3&sort=total_amount&dir=asc"),
      ),
    );
    expect(f.from).toBe("2026-03-01");
    expect(f.q).toBe("ORD-9");
    expect(f.page).toBe(3);
    expect(f.sort).toBe("total_amount");
    expect(f.dir).toBe("asc");
  });

  it("Reconciliation (zero-def: date only; the mode is client state)", () => {
    const f = reconciliationFiltersSchema.parse(
      Object.fromEntries(new URLSearchParams("from=2026-04-01&to=2026-04-30")),
    );
    expect(f).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });
});

/**
 * Remembered filters (migration 0049): every standard def persists per user per
 * brand, and a saved view overrides the whole mechanism. Both halves are
 * page-level wiring, so they are guarded at the source — a new filter-bearing
 * page that forgets either one is a silent bug (a default view quietly
 * overridden by a preference, or a preference that never applies).
 */
describe("remembered filters are wired into every page that has them", () => {
  const PREF_PAGES = [
    "app/(dashboard)/summary/page.tsx",
    "app/(dashboard)/library/page.tsx",
    "app/(dashboard)/campaigns/page.tsx",
    "app/(dashboard)/canvas/page.tsx",
    "app/(dashboard)/budget/pacing/page.tsx",
  ];

  it("each page resolves its keys server-side", () => {
    for (const file of PREF_PAGES) {
      expect(readFileSync(file, "utf8")).toContain("resolveFilterPrefs(");
    }
  });

  it("every default-view redirect stamps the marker, so the view wins", () => {
    for (const file of PREF_PAGES) {
      const src = readFileSync(file, "utf8");
      const redirects = [...src.matchAll(/redirect\(`[^`]+`\)/g)].map((m) => m[0]!);
      for (const r of redirects) {
        if (!r.includes("def.query")) continue; // not a saved-view redirect
        expect(r).toContain("VIEW_MARKER_PARAM");
      }
      // (The skip itself is central — `resolveFilterPrefs` reads the marker —
      // so a page cannot forget it; stamping the redirect is the page's half.)
    }
  });

  it("the marker is transient in the Views control — never stored in a view", () => {
    const src = readFileSync("components/summary/views-control.tsx", "utf8");
    const decl = src.match(/const TRANSIENT_PARAMS = new Set\(\[[\s\S]*?\]\)/)![0];
    expect(decl).toContain("VIEW_MARKER_PARAM");
    expect(decl).toContain("FILTERS_EXPLICIT_PARAM");
    // Applying a view stamps the marker too: the view owns what it left out.
    expect(src).toContain("${VIEW_MARKER_PARAM}=${viewId}");
  });

  it("suppresses preferences on a view URL and on an explicit filter URL", () => {
    const from = (qs: string) => {
      const p = new URLSearchParams(qs);
      return (key: string) => p.get(key) ?? undefined;
    };
    expect(prefsSuppressed(from("platforms=meta"))).toBe(false);
    expect(prefsSuppressed(from(`platforms=meta&${VIEW_MARKER_PARAM}=v1`))).toBe(true);
    expect(prefsSuppressed(from(`platforms=meta&${FILTERS_EXPLICIT_PARAM}=1`))).toBe(true);
  });

  it("the marker is not Library's `view` (that one is grid/table)", () => {
    expect(VIEW_MARKER_PARAM).not.toBe("view");
    expect(creativeListFiltersSchema.parse({ view: "table" }).view).toBe("table");
  });
});
