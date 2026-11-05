import { describe, expect, it } from "vitest";
import { versionDataSchema } from "../schema";
import { exportFileName, IMPORT_ERROR, importDocument, slugify, toExport } from "./export-import";
import { sampleVersionData } from "./sample";

const NOW = new Date("2026-11-05T10:20:30Z");

describe("export (§9.1)", () => {
  it("carries the format header and the whole document", () => {
    const data = sampleVersionData();
    const out = toExport("Main", data, NOW);
    expect(out).toMatchObject({ format: "price-structure-module", formatVersion: 1, name: "Main", exportedAt: NOW.toISOString() });
    expect(out.products).toBe(data.products);
    expect(out.plans).toBe(data.plans);
  });
  it("file name keeps a–z, 0–9 and Arabic letters", () => {
    expect(exportFileName("Ramadan pricing!", NOW)).toBe("price-structure-ramadan-pricing-2026-11-05.json");
    expect(slugify("تسعير رمضان 2026")).toBe("تسعير-رمضان-2026");
    expect(exportFileName("***", NOW)).toBe("price-structure-version-2026-11-05.json");
  });
  it("our own export imports back unchanged", () => {
    const data = sampleVersionData();
    const res = importDocument(JSON.parse(JSON.stringify(toExport("Main", data, NOW))));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.name).toBe("Main");
    expect(res.warnings).toEqual([]);
    const parsed = versionDataSchema.safeParse(res.candidate);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(data);
  });
});

describe("import from the old tool (§9.3)", () => {
  const data = sampleVersionData();
  const old = {
    version: 4,
    products: data.products,
    scenarios: [
      {
        id: "s1", name: "Base", colorSlot: 0, notes: "",
        assumptions: { vatRate: 0.15, pricesIncludeVat: true, usdToSar: 3.75, deliveryRate: 0.85, undeliveredCost: 0, priceChange: 0, unitCostChange: 0, adCostChange: 0, extraDiscount: 0 },
      },
      {
        id: "s2", name: "Aggressive", colorSlot: 1, notes: "",
        assumptions: { vatRate: 0.15, pricesIncludeVat: false, usdToSar: 3.75, deliveryRate: 0.8, undeliveredCost: 25, priceChange: 0.1, unitCostChange: 0, adCostChange: -0.2, extraDiscount: 0 },
      },
    ],
    activeScenarioId: "s2",
    targets: [...data.targets, { id: "be", metric: "breakEvenRoas", a: 1, b: 1, enabled: true }],
    costLines: [{ id: "c", name: "Rent", amount: 1000 }],
    plans: [],
    activePlanId: "",
    actuals: undefined,
  };
  it("takes the active scenario's settings, warns about its levers, drops the rest", () => {
    const res = importDocument(JSON.parse(JSON.stringify(old)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.name).toBeNull();
    expect(res.warnings).toEqual([
      "Scenario adjustments (price change, ad cost change) were not imported; the module has no scenarios.",
    ]);
    const parsed = versionDataSchema.safeParse(res.candidate);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.settings).toEqual({ vatRate: 0.15, pricesIncludeVat: false, usdToSar: 3.75, deliveryRate: 0.8, undeliveredCost: 25 });
    expect(parsed.data.targets.map((t) => t.metric)).toEqual(["margin", "profit"]);
    expect(parsed.data.roasTargetId).toBe("");
    expect(parsed.data.plans).toHaveLength(1);
    expect(parsed.data.plans[0]!.ordersPerDay).toBe(100);
    expect(parsed.data.activePlanId).toBe(parsed.data.plans[0]!.id);
    expect(parsed.data.plans[0]!.productShare[data.products[0]!.id]).toBeCloseTo(0.2, 9);
    expect(parsed.data.actuals).toEqual([]);
    // ids are kept so plan shares and actual orders still match
    expect(parsed.data.products[0]!.id).toBe(data.products[0]!.id);
    expect("costLines" in parsed.data).toBe(false);
  });
  it("falls back to the first scenario when the active one is missing", () => {
    const res = importDocument({ ...old, activeScenarioId: "nope" });
    expect(res.ok && (res.candidate as { settings: { deliveryRate: number } }).settings.deliveryRate).toBe(0.85);
  });
  it("rejects anything else", () => {
    expect(importDocument(null)).toEqual({ ok: false, error: IMPORT_ERROR });
    expect(importDocument({ hello: 1 })).toEqual({ ok: false, error: IMPORT_ERROR });
    expect(importDocument({ products: [] })).toEqual({ ok: false, error: IMPORT_ERROR });
    expect(importDocument({ products: [], scenarios: [{ id: "x" }] })).toEqual({ ok: false, error: IMPORT_ERROR });
    expect(importDocument({ products: "no", settings: data.settings })).toEqual({ ok: false, error: IMPORT_ERROR });
  });
  it("a document with a bad product still fails the schema", () => {
    const res = importDocument({ settings: data.settings, products: [{ id: "p", name: "x" }] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(versionDataSchema.safeParse(res.candidate).success).toBe(false);
  });
});
