import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sparkline } from "@/components/charts/sparkline";

const render = (props: Parameters<typeof Sparkline>[0]) =>
  renderToStaticMarkup(createElement(Sparkline, props));

describe("Sparkline — the no-data dash", () => {
  // W3 (375px): the Funnel's rate tiles draw a RESPONSIVE 200-unit line in
  // a ~165px phone tile. With no data the dash kept the fixed 200px width
  // and pushed the page to 409px.
  it("stretches to its parent when the line is responsive", () => {
    const html = render({ values: [], width: 200, height: 34, responsive: true });
    expect(html).toContain("width:100%");
    expect(html).not.toContain("width:200px");
  });

  it("keeps its logical width when the line is fixed", () => {
    const html = render({ values: [], width: 80, height: 22 });
    expect(html).toContain("width:80px");
  });

  it("a responsive line with data is 100% wide too (the shape the dash mirrors)", () => {
    const html = render({ values: [1, 2, 3], width: 200, height: 34, responsive: true });
    expect(html).toContain('width="100%"');
  });
});
