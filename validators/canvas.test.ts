import { describe, expect, it } from "vitest";
import { CANVAS_DEFAULT_STATUSES, canvasFiltersSchema } from "@/validators/canvas";

describe("canvasFiltersSchema", () => {
  it("?view= accepts the three views", () => {
    for (const view of ["network", "campaign", "creative"]) {
      expect(canvasFiltersSchema.parse({ view }).view).toBe(view);
    }
  });

  it("a missing or bogus ?view= falls back to the network — never throws", () => {
    expect(canvasFiltersSchema.parse({}).view).toBe("network");
    expect(canvasFiltersSchema.parse({ view: "trees" }).view).toBe("network");
    expect(canvasFiltersSchema.parse({ view: "" }).view).toBe("network");
  });

  it("the view never disturbs the other filters", () => {
    const parsed = canvasFiltersSchema.parse({
      view: "campaign",
      platforms: "google,bogus",
      stages: "Awareness,unassigned",
    });
    expect(parsed.view).toBe("campaign");
    expect(parsed.platforms).toEqual([]); // one bad value drops the filter
    expect(parsed.stages).toEqual(["Awareness", "unassigned"]);
  });

  it("terminated is hidden by default", () => {
    expect(CANVAS_DEFAULT_STATUSES).not.toContain("terminated");
    expect(CANVAS_DEFAULT_STATUSES).toHaveLength(3);
  });
});
