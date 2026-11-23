import { describe, expect, it } from "vitest";
import { lineSaleDiscount, regularLineTotal } from "@/store/sale-price";

describe("sale prices", () => {
  // Listed at 350 incl. VAT, sold at 299 incl. VAT: Salla sends both excl. VAT.
  const watch = { quantity: 1, lineTotal: 299, unitPrice: 260, originalUnitPrice: 304.35 };

  it("the markdown is (regular − sold) × quantity, excl. VAT", () => {
    expect(lineSaleDiscount(watch)).toBe(44.35);
    expect(lineSaleDiscount({ ...watch, quantity: 2 })).toBe(88.7);
  });

  it("the regular line total adds the markdown back incl. VAT", () => {
    expect(regularLineTotal(watch)).toBe(350);
    // Rounded per unit incl. VAT, as listed: 2 × 350.00, never 700.01.
    expect(regularLineTotal({ ...watch, quantity: 2, lineTotal: 598 })).toBe(700);
  });

  it("not on sale, unknown, or priced above regular: no markdown, no regular price", () => {
    for (const l of [
      { ...watch, originalUnitPrice: 260 },
      { ...watch, originalUnitPrice: null },
      { ...watch, unitPrice: null },
      { ...watch, originalUnitPrice: 200 },
    ]) {
      expect(lineSaleDiscount(l)).toBe(0);
      expect(regularLineTotal(l)).toBeNull();
    }
    expect(regularLineTotal({ ...watch, lineTotal: null })).toBeNull();
  });
});
