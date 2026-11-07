import { describe, expect, it } from "vitest";
import { changedSections, newEditSections } from "@/price-structure/edit-sections";
import { blankVersionData } from "@/price-structure/engine/sample";

const doc = (patch: Partial<{ name: string; notes: string }> = {}) => ({
  name: "Main",
  notes: "",
  data: blankVersionData(),
  ...patch,
});

describe("changedSections", () => {
  it("names nothing for an unchanged save", () => {
    const a = doc();
    expect(changedSections(a, { ...a, data: structuredClone(a.data) })).toEqual([]);
  });

  it("names each section that moved, in display order", () => {
    const a = doc();
    const b = doc({ name: "Ramadan" });
    b.data = structuredClone(a.data);
    b.data.settings = { ...b.data.settings, vatRate: 0.2 };
    b.data.roasTargetId = "something-else";
    expect(changedSections(a, b)).toEqual(["name", "settings", "targets"]);
  });
});

describe("newEditSections — one line per person per section per sitting", () => {
  it("drops what the sitting already recorded", () => {
    expect(newEditSections(["products", "targets"], ["products"])).toEqual(["targets"]);
    expect(newEditSections(["products"], ["products", "plans"])).toEqual([]);
    expect(newEditSections(["plans"], [])).toEqual(["plans"]);
  });
});
