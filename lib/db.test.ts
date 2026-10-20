import { describe, expect, it } from "vitest";
import { poolMax } from "@/lib/db";

describe("poolMax — the pool size lib/db opens", () => {
  it("is ONE in production and ten in dev, by default", () => {
    expect(poolMax({ NODE_ENV: "production" })).toBe(1);
    expect(poolMax({ NODE_ENV: "development" })).toBe(10);
    expect(poolMax({})).toBe(10);
  });

  it("honours DB_POOL_MAX — the DB suite sets 1 to run at production size", () => {
    expect(poolMax({ NODE_ENV: "development", DB_POOL_MAX: "1" })).toBe(1);
    expect(poolMax({ NODE_ENV: "production", DB_POOL_MAX: "4" })).toBe(4);
    expect(poolMax({ DB_POOL_MAX: " 2 " })).toBe(2);
  });

  it("ignores a value that is not a positive whole number", () => {
    for (const bad of ["", "0", "-1", "1.5", "ten", "01"]) {
      expect(poolMax({ NODE_ENV: "production", DB_POOL_MAX: bad })).toBe(1);
    }
  });
});
