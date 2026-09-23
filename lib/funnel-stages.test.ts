import { describe, expect, it } from "vitest";
import { BUDGET_OBJECTIVES } from "@/lib/budget";
import {
  FUNNEL_STAGES as AUDIENCE_STAGES,
  stageLabel as audienceStageLabel,
} from "@/lib/audience";
import { readFileSync } from "node:fs";
import {
  CREATIVE_STAGE_OPTIONS,
  FUNNEL_STAGES,
  NA_STAGE,
  STAGE_FILTER_VALUES,
  STAGE_SHORT,
  compareStages,
  isCreativeStage,
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

  it("offers every creative stage plus Unassigned as filter tokens", () => {
    // The creative vocabulary (the funnel + N/A), then Unassigned last.
    expect(STAGE_FILTER_VALUES).toEqual([...CREATIVE_STAGE_OPTIONS, "unassigned"]);
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

  it("caps at the number of stage values that exist", () => {
    // One more than the vocabulary can't be anything but repetition.
    expect(
      stagesSchema.safeParse([...CREATIVE_STAGE_OPTIONS, "Awareness"]).success,
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

// ── N/A: the explicit "no clear stage" declaration (2026-09) ────────────────
// THREE STATES: [] unassigned (not yet declared) · ["N/A"] declared, no clear
// stage · ["Awareness", …] declared stages. N/A is CREATIVE-SIDE ONLY.

describe("N/A is creative-side only — the funnel axis must never see it", () => {
  it("FUNNEL_STAGES still has EXACTLY the three, and no N/A", () => {
    expect(FUNNEL_STAGES).toHaveLength(3);
    expect([...FUNNEL_STAGES]).toEqual(["Awareness", "Activation", "Retargeting"]);
    expect((FUNNEL_STAGES as readonly string[]).includes(NA_STAGE)).toBe(false);
    // Still the budget axis minus "Other" — the derivation is untouched.
    expect([...FUNNEL_STAGES]).toEqual(BUDGET_OBJECTIVES.filter((o) => o !== "Other"));
    // …and the audience module re-exports that same list.
    expect([...AUDIENCE_STAGES]).toEqual([...FUNNEL_STAGES]);
    expect((AUDIENCE_STAGES as readonly string[]).includes(NA_STAGE)).toBe(false);
  });

  it("CREATIVE_STAGE_OPTIONS is the funnel plus N/A, in that order", () => {
    expect([...CREATIVE_STAGE_OPTIONS]).toEqual([...FUNNEL_STAGES, NA_STAGE]);
    expect(isCreativeStage(NA_STAGE)).toBe(true);
    expect(isFunnelStage(NA_STAGE)).toBe(false); // the guard the audience board uses
  });

  it("neither lib/audience.ts nor lib/budget.ts CONSUMES the creative vocabulary", () => {
    // A source-level guard: the leak this separation exists to prevent would
    // arrive as an import, and a type test can't see one that isn't there.
    for (const file of ["lib/audience.ts", "lib/budget.ts"]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toContain("CREATIVE_STAGE_OPTIONS");
      expect(src).not.toContain("NA_STAGE");
      expect(src).not.toContain("isCreativeStage");
    }
  });

  it("the audience side's labels are unchanged by N/A existing", () => {
    expect(audienceStageLabel("Awareness")).toBe("Awareness · TOF");
    expect(STAGE_SHORT.Awareness).toBe("TOF");
    // N/A IS its own short form — there is no three-letter word for "no stage".
    expect(STAGE_SHORT[NA_STAGE]).toBe(NA_STAGE);
    expect(stageLabel(NA_STAGE)).toBe(NA_STAGE);
  });
});

describe("N/A ordering and normalization", () => {
  it("ranks after the three funnel stages", () => {
    expect(stageRank(NA_STAGE)).toBe(3);
    expect(stageRank("Retargeting")).toBeLessThan(stageRank(NA_STAGE));
    expect(stageRank("nonsense")).toBeGreaterThan(stageRank(NA_STAGE));
  });

  it("sortStages keeps funnel order with N/A LAST, and still drops junk", () => {
    expect(sortStages([NA_STAGE, "Retargeting", "Awareness"])).toEqual([
      "Awareness",
      "Retargeting",
      NA_STAGE,
    ]);
    expect(sortStages([NA_STAGE, NA_STAGE])).toEqual([NA_STAGE]);
    expect(sortStages(["Other", NA_STAGE])).toEqual([NA_STAGE]);
  });

  it("compareStages: Awareness < Activation < Retargeting < N/A < unassigned", () => {
    const order = [["Awareness"], ["Activation"], ["Retargeting"], [NA_STAGE], []];
    const shuffled = [[], [NA_STAGE], ["Retargeting"], ["Awareness"], ["Activation"]];
    expect([...shuffled].sort((a, b) => compareStages(a, b, 1))).toEqual(order);
    // Descending REVERSES the declared ones but keeps unassigned last.
    expect([...shuffled].sort((a, b) => compareStages(a, b, -1))).toEqual([
      [NA_STAGE],
      ["Retargeting"],
      ["Activation"],
      ["Awareness"],
      [],
    ]);
  });

  it("N/A sorts as a DECLARATION, ahead of unassigned in both directions", () => {
    expect(compareStages([NA_STAGE], [], 1)).toBeLessThan(0);
    expect(compareStages([NA_STAGE], [], -1)).toBeLessThan(0);
  });
});

describe("the stage FILTER gains N/A beside Unassigned", () => {
  it("offers both, as separate tokens, N/A before Unassigned", () => {
    expect([...STAGE_FILTER_VALUES]).toEqual([...FUNNEL_STAGES, NA_STAGE, "unassigned"]);
    expect(stageFilterLabel(NA_STAGE)).toBe(NA_STAGE);
    expect(stageFilterLabel("unassigned")).toBe("Unassigned");
  });

  it("splits N/A into the STAGE set — it is a value on the row, not an absence", () => {
    expect(splitStageFilter([NA_STAGE])).toEqual({ stages: [NA_STAGE], unassigned: false });
    expect(splitStageFilter([NA_STAGE, "unassigned", "Awareness"])).toEqual({
      stages: ["Awareness", NA_STAGE],
      unassigned: true,
    });
  });
});

describe("stagesSchema — N/A is EXCLUSIVE", () => {
  it("accepts N/A alone", () => {
    expect(stagesSchema.parse([NA_STAGE])).toEqual([NA_STAGE]);
  });

  it("REJECTS N/A combined with any funnel stage (a hand-rolled request)", () => {
    for (const mix of [[NA_STAGE, "Awareness"], ["Retargeting", NA_STAGE]]) {
      const res = stagesSchema.safeParse(mix);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toBe(
          `"${NA_STAGE}" can't be combined with a funnel stage.`,
        );
      }
    }
  });

  it("still accepts the funnel stages and the empty (unassigned) set", () => {
    expect(stagesSchema.parse([])).toEqual([]);
    expect(stagesSchema.parse(["Retargeting", "Awareness"])).toEqual([
      "Awareness",
      "Retargeting",
    ]);
  });
});
