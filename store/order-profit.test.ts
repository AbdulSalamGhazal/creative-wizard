import { describe, expect, it } from "vitest";
import { orderProfit } from "@/store/order-profit";
import { beforeVat, SAUDI_VAT_RATE } from "@/store/vat";

describe("an order's gross profit — sales before VAT minus product cost", () => {
  it("removes the 15% VAT from what was paid", () => {
    expect(SAUDI_VAT_RATE).toBe(0.15);
    expect(beforeVat(299)).toBe(260);
    expect(beforeVat(115)).toBe(100);
  });

  it("every line costed: cost and profit over all of them", () => {
    const p = orderProfit([
      { quantity: 1, lineTotal: 299, unitCost: 84 },
      { quantity: 2, lineTotal: 230, unitCost: 30.5 },
    ]);
    expect(p).toEqual({ costed: 2, lines: 2, cost: 145, grossProfit: 260 + 200 - 145 });
  });

  it("a line without a cost: the cost of the others is shown, the profit is not guessed", () => {
    const p = orderProfit([
      { quantity: 1, lineTotal: 299, unitCost: 84 },
      { quantity: 1, lineTotal: 100, unitCost: null },
    ]);
    expect(p).toEqual({ costed: 1, lines: 2, cost: 84, grossProfit: null });
  });

  it("no cost at all, or no lines", () => {
    expect(orderProfit([{ quantity: 1, lineTotal: 299, unitCost: null }])).toMatchObject({ costed: 0, grossProfit: null });
    expect(orderProfit([])).toEqual({ costed: 0, lines: 0, cost: 0, grossProfit: null });
  });

  it("a line with a cost but no SAR total counts its cost and withholds the profit", () => {
    expect(orderProfit([{ quantity: 2, lineTotal: null, unitCost: 10 }])).toEqual({
      costed: 1,
      lines: 1,
      cost: 20,
      grossProfit: null,
    });
  });
});
