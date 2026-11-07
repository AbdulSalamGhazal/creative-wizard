import { describe, expect, it } from "vitest";
import { readChartView } from "@/components/charts/use-chart-view";

const M = ["spend", "roas"] as const;
const view = (qs: string) => readChartView(new URLSearchParams(qs), "ot", M, "spend");

describe("chart view in the URL (R-102)", () => {
  it("absent params are the defaults", () => {
    expect(view("")).toEqual({ metric: "spend", smooth: false, group: false });
  });
  it("reads its own prefixed params", () => {
    expect(view("otm=roas&ots=1&otg=1")).toEqual({ metric: "roas", smooth: true, group: true });
  });
  it("an unknown metric or another chart's params read as the default", () => {
    expect(view("otm=bogus&ccm=roas&ccs=1")).toEqual({ metric: "spend", smooth: false, group: false });
  });
});
