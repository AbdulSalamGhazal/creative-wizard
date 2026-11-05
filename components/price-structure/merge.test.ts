import { describe, expect, it } from "vitest";
import { sampleVersionData } from "@/price-structure/engine/sample";
import { deepEqual, mergeOnConflict, sectionGet, sectionSet, type VersionDoc } from "./merge";

const doc = (): VersionDoc => ({ name: "Main", notes: "", data: sampleVersionData() });

describe("sections", () => {
  it("addresses products by id, not position", () => {
    const d = doc();
    const p1 = d.data.products[1]!;
    expect(sectionGet(d, `data.products.${p1.id}`)).toBe(p1);
    const reordered = sectionSet(d, "data.products.order", [...d.data.products.map((p) => p.id)].reverse());
    expect(sectionGet(reordered, `data.products.${p1.id}`)).toBe(p1);
    expect(reordered.data.products[0]).toBe(d.data.products[4]);
    // Ids missing from the order keep their place at the end; unknown ids are ignored.
    const partial = sectionSet(d, "data.products.order", [p1.id, "nope"]);
    expect(partial.data.products.map((p) => p.id)).toEqual([p1.id, ...d.data.products.filter((p) => p !== p1).map((p) => p.id)]);
  });
  it("sets, appends and removes items", () => {
    const d = doc();
    const p0 = d.data.products[0]!;
    const edited = sectionSet(d, `data.products.${p0.id}`, { ...p0, price: 999 });
    expect(edited.data.products[0]!.price).toBe(999);
    expect(edited.data.products[1]).toBe(d.data.products[1]);
    const appended = sectionSet(d, "data.products.new", { ...p0, id: "new" });
    expect(appended.data.products).toHaveLength(6);
    const removed = sectionSet(d, `data.products.${p0.id}`, undefined);
    expect(removed.data.products).toHaveLength(4);
    expect(sectionSet(d, "data.settings", { ...d.data.settings, vatRate: 0 }).data.settings.vatRate).toBe(0);
    expect(sectionSet(d, "name", "Other").name).toBe("Other");
    expect(sectionSet(d, "nonsense.path", 1)).toBe(d);
  });
});

describe("mergeOnConflict", () => {
  it("re-applies our edit when the server changed something else", () => {
    const base = doc();
    const p0 = base.data.products[0]!;
    const local = sectionSet(base, `data.products.${p0.id}`, { ...p0, price: 400 });
    const server = sectionSet(base, "data.settings", { ...base.data.settings, deliveryRate: 0.9 });
    const out = mergeOnConflict(base, local, server, [`data.products.${p0.id}`]);
    expect(out.kind).toBe("reapplied");
    if (out.kind !== "reapplied") return;
    expect(out.doc.data.products[0]!.price).toBe(400);
    expect(out.doc.data.settings.deliveryRate).toBe(0.9);
  });
  it("takes the server copy when the same section changed on both sides", () => {
    const base = doc();
    const p0 = base.data.products[0]!;
    const local = sectionSet(base, `data.products.${p0.id}`, { ...p0, price: 400 });
    const server = sectionSet(base, `data.products.${p0.id}`, { ...p0, unitCost: 95 });
    const out = mergeOnConflict(base, local, server, [`data.products.${p0.id}`]);
    expect(out).toEqual({ kind: "server", conflicting: [`data.products.${p0.id}`] });
  });
  it("a product edited here and deleted there is a conflict", () => {
    const base = doc();
    const p0 = base.data.products[0]!;
    const local = sectionSet(base, `data.products.${p0.id}`, { ...p0, price: 400 });
    const server = sectionSet(base, `data.products.${p0.id}`, undefined);
    expect(mergeOnConflict(base, local, server, [`data.products.${p0.id}`]).kind).toBe("server");
  });
  it("deepEqual", () => {
    expect(deepEqual({ a: [1, { b: NaN }] }, { a: [1, { b: NaN }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });
});
