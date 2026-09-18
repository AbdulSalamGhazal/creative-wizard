import { describe, expect, it } from "vitest";
import { BUDGET_OBJECTIVES } from "@/lib/budget";
import {
  FUNNEL_STAGES as AUDIENCE_STAGES,
  stageLabel as audienceStageLabel,
} from "@/lib/audience";
import {
  FUNNEL_STAGES,
  STAGE_FILTER_VALUES,
  STAGE_SHORT,
  compareStages,
  isFunnelStage,
  sortStages,
  splitStageFilter,
  stageFilterLabel,
  stageLabel,
  stageRank,
} from "@/lib/funnel-stages";
import { stagesSchema } from "@/validators/creative";
import { creativeListFiltersSchema } from "@/validators/creative";
import { summaryFiltersSchema } from "@/validators/summary";

describe("one stage vocabulary, derived not re-listed", () => {
  it("is the budget buckets minus Other, in funnel order", () => {
    expect(FUNNEL_STAGES).toEqual(BUDGET_OBJECTIVES.filter((o) => o !== "Other"));
    expect(FUNNEL_STAGES).toEqual(["Awareness", "Activation", "Retargeting"]);
    expect(stageRank("Awareness")).toBeLessThan(stageRank("Activation"));
    expect(stageRank("Activation")).toBeLessThan(stageRank("Retargeting"));
  });

  it("lib/audience re-exports the SAME list (no second copy)", () => {
    expect(AUDIENCE_STAGES).toBe(FUNNEL_STAGES);
    expect(audienceStageLabel("Awareness")).toBe(stageLabel("Awareness"));
  });

  it("labels each stage with both names, and knows its shorthand", () => {
    expect(stageLabel("Awareness")).toBe("Awareness · TOF");
    expect(STAGE_SHORT.Activation).toBe("MOF");
    expect(STAGE_SHORT.Retargeting).toBe("BOF");
    expect(isFunnelStage("Other")).toBe(false); // a bucket, not a stage
    expect(isFunnelStage("Awareness")).toBe(true);
  });

  it("offers the three stages plus Unassigned as filter tokens", () => {
    expect(STAGE_FILTER_VALUES).toEqual([...FUNNEL_STAGES, "unassigned"]);
    expect(stageFilterLabel("unassigned")).toBe("Unassigned");
    expect(stageFilterLabel("Retargeting")).toBe("Retargeting · BOF");
  });
});

describe("stagesSchema", () => {
  it("dedupes and stores in funnel order, whatever order they arrive in", () => {
    expect(stagesSchema.parse(["Retargeting", "Awareness", "Awareness"])).toEqual([
      "Awareness",
      "Retargeting",
    ]);
    expect(stagesSchema.parse([])).toEqual([]); // unassigned is valid
  });

  it("refuses a value that isn't a funnel stage, including the Other bucket", () => {
    expect(stagesSchema.safeParse(["Other"]).success).toBe(false);
    expect(stagesSchema.safeParse(["Sales"]).success).toBe(false);
    expect(stagesSchema.safeParse(["awareness"]).success).toBe(false); // case matters
  });

  it("caps at the number of stages that exist", () => {
    expect(
      stagesSchema.safeParse([...FUNNEL_STAGES, "Awareness"]).success,
    ).toBe(false);
    expect(stagesSchema.safeParse([...FUNNEL_STAGES]).success).toBe(true);
  });
});

describe("compareStages — earliest stage, unassigned last", () => {
  const sortWith = (dir: 1 | -1) =>
    [["Retargeting"], [], ["Awareness", "Retargeting"], ["Activation"], []]
      .slice()
      .sort((a, b) => compareStages(a, b, dir));

  it("ranks a multi-stage creative by its EARLIEST stage", () => {
    // {Awareness, Retargeting} enters the funnel at Awareness.
    expect(compareStages(["Awareness", "Retargeting"], ["Activation"], 1)).toBeLessThan(0);
    expect(compareStages(["Retargeting", "Awareness"], ["Awareness"], 1)).toBe(0);
  });

  it("ascending: TOF → BOF, unassigned last", () => {
    expect(sortWith(1)).toEqual([
      ["Awareness", "Retargeting"],
      ["Activation"],
      ["Retargeting"],
      [],
      [],
    ]);
  });

  it("descending: BOF → TOF, and unassigned STILL last", () => {
    // Unassigned means nobody has declared a stage — not a late one.
    expect(sortWith(-1)).toEqual([
      ["Retargeting"],
      ["Activation"],
      ["Awareness", "Retargeting"],
      [],
      [],
    ]);
  });

  it("ignores unrecognised values when ranking", () => {
    expect(compareStages(["Other"], [], 1)).toBe(0); // both count as unassigned
    expect(compareStages(["Other", "Activation"], ["Activation"], -1)).toBe(0);
  });
});

describe("stage filter tokens", () => {
  it("splits into the stage set and the unassigned flag", () => {
    expect(splitStageFilter(["Retargeting", "Awareness"])).toEqual({
      stages: ["Awareness", "Retargeting"],
      unassigned: false,
    });
    expect(splitStageFilter(["unassigned"])).toEqual({ stages: [], unassigned: true });
    expect(splitStageFilter(["Awareness", "unassigned", "nope"])).toEqual({
      stages: ["Awareness"],
      unassigned: true,
    });
  });

  it("keeps a set in funnel order", () => {
    expect(sortStages(["Retargeting", "Awareness", "Activation"])).toEqual([
      "Awareness",
      "Activation",
      "Retargeting",
    ]);
  });
});

describe("the filter parses additively on both surfaces", () => {
  it("Library: absent = no filter; junk tokens drop, valid siblings survive", () => {
    expect(creativeListFiltersSchema.parse({}).stages).toEqual([]);
    expect(
      creativeListFiltersSchema.parse({ stages: "Awareness,unassigned" }).stages,
    ).toEqual(["Awareness", "unassigned"]);
    expect(creativeListFiltersSchema.parse({ stages: "Other,Activation" }).stages).toEqual([
      "Activation",
    ]);
  });

  it("Ads: a saved view written BEFORE Stage existed still round-trips", () => {
    const saved = {
      from: "2026-01-01",
      to: "2026-01-31",
      platforms: "instagram,facebook",
      types: "video",
      priorities: "3",
      sort: "total.spend",
      dir: "desc",
    };
    const parsed = summaryFiltersSchema.parse(saved);
    expect(parsed.stages).toEqual([]); // absent = no filter, nothing throws
    expect(parsed.priorities).toEqual(["3"]); // the previous addition still works
    expect(parsed.platforms).toEqual(["instagram", "facebook"]);
    expect(parsed.sort).toBe("total.spend");
  });

  it("Ads: Stage is a hideable identity column, like its siblings", () => {
    expect(summaryFiltersSchema.parse({ hideIdentity: "stage,priority" }).hideIdentity).toEqual([
      "stage",
      "priority",
    ]);
  });
});
