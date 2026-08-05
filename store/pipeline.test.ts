import { describe, expect, it } from "vitest";
import { runStorePipeline } from "@/store/pipeline";
import { parseStoreDate, parseStoreNumber } from "@/store/parse";
import type { StoreField } from "@/store/fields";

// Field config helpers.
const core = (
  key: "order_id" | "order_date" | "total_amount",
  headers: string[],
  label = key,
): StoreField => ({
  id: key,
  key,
  label,
  type: key === "order_date" ? "date" : key === "total_amount" ? "number" : "text",
  required: true,
  headers,
  sortOrder: 0,
  core: true,
});
const custom = (
  key: string,
  type: "text" | "number" | "date",
  headers: string[],
  required: boolean,
): StoreField => ({
  id: key,
  key,
  label: key,
  type,
  required,
  headers,
  sortOrder: 5,
  core: false,
});

const CORE = [
  core("order_id", ["Order ID", "رقم الطلب"]),
  core("order_date", ["Order Date"]),
  core("total_amount", ["Total"]),
];

function run(csv: string, fields: StoreField[], opts?: { existing?: string[]; upsert?: boolean }) {
  return runStorePipeline({
    content: csv,
    fields,
    existingOrderIds: new Set(opts?.existing ?? []),
    upsert: opts?.upsert ?? false,
  });
}

describe("parse helpers", () => {
  it("parseStoreDate accepts date and datetime, keeps the date part", () => {
    expect(parseStoreDate("2026-08-04")).toBe("2026-08-04");
    expect(parseStoreDate("2026-08-04 13:45:00")).toBe("2026-08-04");
    expect(parseStoreDate("2026-08-04T13:45")).toBe("2026-08-04");
    expect(parseStoreDate("2026-13-40")).toBeNull(); // invalid calendar date
    expect(parseStoreDate("04/08/2026")).toBeNull(); // wrong format
  });

  it("parseStoreNumber strips currency symbols and commas", () => {
    expect(parseStoreNumber("1,234.50")).toBe(1234.5);
    expect(parseStoreNumber("SAR 1,234.50")).toBe(1234.5);
    expect(parseStoreNumber("﷼ 99")).toBe(99);
    expect(parseStoreNumber("-50")).toBe(-50);
    expect(parseStoreNumber("abc")).toBeNull();
  });
});

describe("runStorePipeline — header mapping", () => {
  it("maps headers case-insensitively after trim (incl. an Arabic header)", () => {
    const csv = ["  ORDER id ,order date, total", "A1,2026-01-01,100"].join("\n");
    const res = run(csv, [
      core("order_id", ["Order ID"]),
      core("order_date", ["Order Date"]),
      core("total_amount", ["Total"]),
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows[0]!.orderId).toBe("A1");
  });

  it("uses the Arabic accepted header when present", () => {
    const csv = ["رقم الطلب,Order Date,Total", "X9,2026-02-02,50"].join("\n");
    const res = run(csv, CORE);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows[0]!.orderId).toBe("X9");
  });

  it("required field with no matching header → S010 fatal (fail fast)", () => {
    const csv = ["Order ID,Order Date", "A1,2026-01-01"].join("\n");
    const res = run(csv, CORE); // Total header absent
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]!.code).toBe("S010");
      expect(res.errors[0]!.message).toContain("Total");
    }
  });

  it("unmapped extra columns are ignored + reported (S060 warning)", () => {
    const csv = ["Order ID,Order Date,Total,Junk", "A1,2026-01-01,100,x"].join("\n");
    const res = run(csv, CORE);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.ignoredColumns).toContain("Junk");
      expect(res.warnings.some((w) => w.code === "S060")).toBe(true);
    }
  });
});

describe("runStorePipeline — row validation", () => {
  it("collects blank order_id, bad date, and non-numeric total", () => {
    const csv = [
      "Order ID,Order Date,Total",
      ",2026-01-01,100", // blank id → S020
      "A2,not-a-date,100", // bad date → S030
      "A3,2026-01-01,abc", // bad total → S040
    ].join("\n");
    const res = run(csv, CORE);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const codes = res.errors.map((e) => e.code).sort();
      expect(codes).toEqual(["S020", "S030", "S040"]);
    }
  });

  it("enforces a required custom field, allows an optional one to be blank", () => {
    const fields = [
      ...CORE,
      custom("status", "text", ["Status"], true),
      custom("payment", "text", ["Payment method"], false),
    ];
    const bad = run(
      ["Order ID,Order Date,Total,Status,Payment method", "A1,2026-01-01,100,,card"].join("\n"),
      fields,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]!.code).toBe("S042");

    const good = run(
      ["Order ID,Order Date,Total,Status,Payment method", "A1,2026-01-01,100,paid,"].join("\n"),
      fields,
    );
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.rows[0]!.attributes.status).toBe("paid");
      expect(good.rows[0]!.attributes.payment).toBeUndefined();
    }
  });

  it("flags an intra-file duplicate order_id (S050)", () => {
    const csv = [
      "Order ID,Order Date,Total",
      "DUP,2026-01-01,10",
      "DUP,2026-01-02,20",
    ].join("\n");
    const res = run(csv, CORE);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const dup = res.errors.find((e) => e.code === "S050");
      expect(dup?.rows).toEqual([2, 3]);
    }
  });
});

describe("runStorePipeline — existing ids", () => {
  const csv = ["Order ID,Order Date,Total", "OLD,2026-01-01,10", "NEW,2026-01-02,20"].join("\n");

  it("strict mode rejects an already-imported id (S051)", () => {
    const res = run(csv, CORE, { existing: ["OLD"], upsert: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.code === "S051")).toBe(true);
  });

  it("upsert splits into 1 update + 1 insert", () => {
    const res = run(csv, CORE, { existing: ["OLD"], upsert: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.newCount).toBe(1);
      expect(res.updatedCount).toBe(1);
      expect(res.rows.find((r) => r.orderId === "OLD")!.isUpdate).toBe(true);
      expect(res.rows.find((r) => r.orderId === "NEW")!.isUpdate).toBe(false);
    }
  });
});
