import { describe, expect, it } from "vitest";
import {
  actualsTemplate,
  blankPeriod,
  parseActualRows,
  parseLooseNumber,
  previousMonth,
  splitCsv,
  templateFileName,
} from "./actuals-csv";
import { sampleVersionData } from "./sample";
import { orderKey } from "./types";

const data = sampleVersionData();
const ultra = data.products[0]!;
const earbuds = data.products[2]!;
const TODAY = new Date(2026, 10, 5); // 5 Nov 2026 → previous month October, 31 days

describe("template (§9.2)", () => {
  const csv = actualsTemplate(data.products, TODAY);
  it("is UTF-8 with BOM, CRLF, one row per offer in display order", () => {
    expect(csv.startsWith("﻿Actuals template,")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).not.toMatch(/[^\r]\n/);
    expect(csv).toContain("Period name,October 2026\r\n");
    expect(csv).toContain("Days in period,31\r\n");
    const rows = splitCsv(csv);
    const header = rows.findIndex((r) => r[0] === "Product");
    expect(rows[header]).toEqual(["Product", "Offer", "Orders", "Product ID", "Offer ID"]);
    expect(rows.slice(header + 1).filter((r) => r.length > 1)).toHaveLength(15);
    expect(rows[header + 1]).toEqual([ultra.name, ultra.offers[0]!.name, "", ultra.id, ultra.offers[0]!.id]);
  });
  it("names the file after the previous month", () => {
    expect(templateFileName(TODAY)).toBe("actuals-template-october.csv");
    expect(previousMonth(new Date(2026, 0, 10))).toEqual({ monthName: "December", name: "December 2025", days: 31 });
    expect(blankPeriod(TODAY)).toMatchObject({ name: "October 2026", days: 31, adSpendUsd: 0, deliveryRate: null, orders: {} });
  });
  it("quotes cells that need it", () => {
    const named = { ...data, products: [{ ...ultra, name: 'Watch "Ultra", 3' }] };
    const csv2 = actualsTemplate(named.products, TODAY);
    expect(csv2).toContain('"Watch ""Ultra"", 3"');
    expect(splitCsv(csv2).find((r) => r[0]?.startsWith("Watch"))?.[0]).toBe('Watch "Ultra", 3');
  });
  it("round-trips: filled in, it parses back to the same offers", () => {
    const filled = csv
      .replace("Ad spend (USD),", "Ad spend (USD),52000")
      .replace(`${ultra.name},${ultra.offers[0]!.name},,`, `${ultra.name},${ultra.offers[0]!.name},900,`)
      .replace(`${earbuds.name},${earbuds.offers[0]!.name},,`, `${earbuds.name},${earbuds.offers[0]!.name},1100,`);
    const res = parseActualRows(splitCsv(filled), data.products);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.period.name).toBe("October 2026");
    expect(res.period.days).toBe(31);
    expect(res.period.adSpendUsd).toBe(52000);
    expect(res.period.metaRoas).toBeNull();
    expect(res.period.deliveryRate).toBeNull();
    expect(res.period.orders).toEqual({
      [orderKey(ultra.id, ultra.offers[0]!.id)]: 900,
      [orderKey(earbuds.id, earbuds.offers[0]!.id)]: 1100,
    });
    expect(res.warnings).toEqual([]);
  });
});

describe("numbers as people type them", () => {
  it("handles currency, grouping, decimal commas and Arabic-Indic digits", () => {
    expect(parseLooseNumber("$12,500")).toBe(12500);
    expect(parseLooseNumber("$3,400.50")).toBe(3400.5);
    expect(parseLooseNumber("٣٤")).toBe(34);
    expect(parseLooseNumber("12,5")).toBe(12.5);
    expect(parseLooseNumber("1,234,567")).toBe(1234567);
    expect(parseLooseNumber("")).toBeNull();
    expect(parseLooseNumber("  ")).toBeNull();
    expect(parseLooseNumber("abc")).toBeNull();
    expect(parseLooseNumber("-5")).toBe(-5);
  });
});

describe("parsing an upload", () => {
  it("a semicolon file with lowercase, re-spaced names and no ids matches by name", () => {
    const text = [
      "period name;  Sept  2026",
      "days in period;30",
      "ad spend (usd);$3,400.50",
      "meta reported roas;3,2",
      "delivery rate %;82",
      "",
      "product;offer;orders",
      `  ${ultra.name.toUpperCase()}  ;15%  OFF;٣٤`,
      `${earbuds.name};buy 2 get 1 free;"1,200"`,
      "Nothing;Nowhere;5",
      `${ultra.name};15% off;6`,
    ].join("\n");
    const res = parseActualRows(splitCsv(text), data.products);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.period.name).toBe("Sept  2026");
    expect(res.period.days).toBe(30);
    expect(res.period.adSpendUsd).toBe(3400.5);
    expect(res.period.metaRoas).toBe(3.2);
    expect(res.period.deliveryRate).toBe(0.82);
    expect(res.period.orders[orderKey(ultra.id, ultra.offers[0]!.id)]).toBe(40); // 34 + 6 summed
    expect(res.period.orders[orderKey(earbuds.id, earbuds.offers[1]!.id)]).toBe(1200);
    expect(res.warnings).toEqual([
      'Row 10: "Nothing · Nowhere" doesn\'t match any product and offer, so it was skipped.',
    ]);
  });
  it("ids win over names when both are present and match", () => {
    const rows = [
      ["Product", "Offer", "Orders", "Product ID", "Offer ID"],
      ["renamed", "renamed", "7", ultra.id, ultra.offers[2]!.id],
    ];
    const res = parseActualRows(rows, data.products);
    expect(res.ok && res.period.orders[orderKey(ultra.id, ultra.offers[2]!.id)]).toBe(7);
  });
  it("missing days and spend warn; a 0.85 delivery rate stays a fraction", () => {
    const rows = [["delivery rate", "0.85"], ["Product", "Offer", "Orders"], [ultra.name, "15% off", "3"]];
    const res = parseActualRows(rows, data.products);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.period.days).toBe(30);
    expect(res.period.name).toBe("Uploaded period");
    expect(res.period.deliveryRate).toBe(0.85);
    expect(res.warnings).toEqual([
      'No "Days in period" found, so 30 days is assumed.',
      "No ad spend found. Enter it below to compare ROAS.",
    ]);
  });
  it("errors", () => {
    expect(parseActualRows([["a", "b"]], data.products)).toEqual({
      ok: false,
      error: 'Could not find the "Product, Offer, Orders" header row. Start from the template.',
    });
    expect(parseActualRows([["Product", "Offer", "Count"]], data.products)).toEqual({
      ok: false,
      error: 'The header row has no "Orders" column.',
    });
    expect(parseActualRows([["Product", "Offer", "Orders"], [ultra.name, "15% off", ""], [ultra.name, "15% off", "0"]], data.products)).toEqual({
      ok: false,
      error: "No orders found. Fill in the Orders column.",
    });
  });
  it("splitCsv handles quotes, escapes, CRLF and a BOM", () => {
    expect(splitCsv('﻿a,"b,c","d""e"\r\nf,g\n')).toEqual([["a", "b,c", 'd"e'], ["f", "g"]]);
    expect(splitCsv("a;b;c\nd;e;f")).toEqual([["a", "b", "c"], ["d", "e", "f"]]);
  });
});
