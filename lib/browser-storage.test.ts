import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * RULES-CENSUS GUARD (2026-10) — the columns system's hardest-won rule,
 * promoted from prose to a test.
 *
 * A column choice, a filter, a saved view and a date range live in the user's
 * ACCOUNT, per brand (`user_table_prefs`, `user_filter_prefs`, `users.*`) — so
 * they follow the person to another machine and can be reasoned about on the
 * server. Phase 2 deleted the per-browser hooks and retired four localStorage
 * keys; phase 3 retired two more. The rule only holds while nothing quietly
 * adds a seventh.
 *
 * (That the retired HOOKS stay deleted is already pinned, correctly scoped to
 * `components/`, by `components/ui/table-columns-coverage.test.ts` — this file
 * does not repeat it. Two guards for one rule disagree eventually, and the
 * one that disagrees by matching a COMMENT is the one that gets deleted.)
 *
 * `localStorage` is not banned — it is the right home for a per-VIEWER
 * convenience that nobody needs on another device. Each surviving use is
 * listed with what it stores and why that is browser-shaped.
 */

const ROOT = process.cwd();

const ALLOWED: Record<string, string> = {
  "app/layout.tsx":
    "the pre-paint theme script: it reads the stored theme before React runs and drops the dead `cw-font` key — it CANNOT come from the server without a flash of the wrong palette",
  "components/layout/sidebar.tsx": "whether the sidebar is collapsed — a per-screen preference",
  "components/comments/comment-drawer.tsx": "whether the comment panel is open — per-screen",
  "components/canvas/canvas-flow.tsx": "whether the canvas legend is expanded — per-screen",
  "components/budget/budget-shared.tsx":
    "the USD/SAR display toggle, which is explicitly display-only (ROAS always computes through the brand rate)",
  "components/layout/notification-bell.tsx":
    "`lastToastedId` per brand — a pointer to what THIS browser has already interrupted you about; it must not follow you to another device",
  "components/summary/summary-table.tsx":
    "the Ads table's drag-resized identity-column widths — THE ONE SURVIVING COLUMN-STATE KEY. The Ads table is a grouped twin and never moved onto DataTable, so the ephemeral-width rule never reached it. Flagged in docs/rules-census.md; it is drift, not a decision",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      out.push(path.relative(ROOT, p));
  }
  return out;
}

/** A real call, not a comment explaining a retired key. */
const CALL = /localStorage\.(get|set|remove)Item/;

describe("per-browser storage stays a short, argued list", () => {
  const files = ["app", "components", "lib"].flatMap((d) => walk(path.join(ROOT, d)));

  it("nothing new persists to localStorage without a reason", () => {
    const users = files.filter((f) => CALL.test(readFileSync(path.join(ROOT, f), "utf8")));
    const rogue = users.filter((f) => !(f in ALLOWED));
    expect(
      rogue,
      "columns, filters, views and ranges belong in the user's account, not this browser",
    ).toEqual([]);
  });

  it("every allowance still exists and still stores something", () => {
    for (const [f, why] of Object.entries(ALLOWED)) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect(CALL.test(src), `${f} is allowed but no longer uses localStorage — drop the entry`).toBe(
        true,
      );
      expect(why.length).toBeGreaterThan(30);
    }
  });
});
