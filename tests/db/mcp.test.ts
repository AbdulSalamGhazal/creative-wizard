import { beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

// NOTE: this suite deliberately does NOT `vi.mock("@/lib/tenant")` — it
// exercises the REAL cookieless override (`runWithTenant` + AsyncLocalStorage +
// `getActiveAccountId`), which is the whole point of the MCP tenant path.

import { db } from "@/lib/db";
import { users, userAccounts, apiTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  runWithTenant,
  getActiveAccountId,
  allowedAccountsForUser,
} from "@/lib/tenant";
import { createApiToken, verifyApiToken, revokeApiToken } from "@/lib/api-token";
import { registerMcpTools } from "@/lib/mcp/tools";
import { runWithMcpActor } from "@/lib/mcp/runtime";
import type { SessionUser } from "@/lib/auth";
import { resetAndSeed } from "./fixtures";

const RESTRICTED_ID = "cccccccc-0000-0000-0000-0000000000c1"; // member of A only
const ADMIN_ID = "cccccccc-0000-0000-0000-0000000000ad"; // all_accounts

const restricted: SessionUser = {
  id: RESTRICTED_ID,
  email: "restricted@mcp.test",
  name: "Restricted",
  role: "editor",
  permissions: null,
  allAccounts: false,
};

beforeAll(async () => {
  await resetAndSeed(); // seeds ACCOUNT_A (with perf data) + ACCOUNT_B
  await db.insert(users).values([
    { id: RESTRICTED_ID, email: "restricted@mcp.test", name: "Restricted", role: "editor", allAccounts: false },
    { id: ADMIN_ID, email: "admin@mcp.test", name: "Admin", role: "admin", allAccounts: true },
  ]);
  await db.insert(userAccounts).values({ userId: RESTRICTED_ID, accountId: ACCOUNT_A });
});

/** Capture the registered tool callbacks without a real MCP server. */
function loadTools(): Map<string, (args: any, extra: any) => Promise<any>> {
  const tools = new Map<string, (args: any, extra: any) => Promise<any>>();
  const stub = {
    registerTool: (name: string, _cfg: unknown, cb: (a: any, e: any) => Promise<any>) => {
      tools.set(name, cb);
    },
  };
  registerMcpTools(stub as never);
  return tools;
}

function parse(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0]!.text);
}

describe("api tokens — create / verify / revoke round-trip", () => {
  it("verifies a fresh token to its owner, then rejects it once revoked", async () => {
    const { raw, row } = await createApiToken(RESTRICTED_ID, "Round-trip");

    const good = await verifyApiToken(`Bearer ${raw}`);
    expect(good?.user.id).toBe(RESTRICTED_ID);
    expect(good?.tokenId).toBe(row.id);

    // Garbage / wrong secret → null, no throw.
    expect(await verifyApiToken("Bearer cwz_not_a_real_token_value_here")).toBeNull();
    expect(await verifyApiToken(null)).toBeNull();
    expect(await verifyApiToken("Bearer xyz")).toBeNull();

    await revokeApiToken(row.id, RESTRICTED_ID);
    expect(await verifyApiToken(`Bearer ${raw}`)).toBeNull();
  });

  it("stamps last_used_at on use", async () => {
    const { raw, row } = await createApiToken(RESTRICTED_ID, "Stamp");
    const [before] = await db
      .select({ lastUsedAt: apiTokens.lastUsedAt })
      .from(apiTokens)
      .where(eq(apiTokens.id, row.id));
    expect(before!.lastUsedAt).toBeNull();
    await verifyApiToken(`Bearer ${raw}`);
    const [after] = await db
      .select({ lastUsedAt: apiTokens.lastUsedAt })
      .from(apiTokens)
      .where(eq(apiTokens.id, row.id));
    expect(after!.lastUsedAt).not.toBeNull();
  });
});

describe("runWithTenant override matrix", () => {
  it("override WINS: getActiveAccountId returns the injected account", async () => {
    const seen = await runWithTenant(ACCOUNT_A, RESTRICTED_ID, () => getActiveAccountId());
    expect(seen).toBe(ACCOUNT_A);
  });

  it("REJECTS a disallowed account for the user", async () => {
    await expect(
      runWithTenant(ACCOUNT_B, RESTRICTED_ID, async () => "unreachable"),
    ).rejects.toThrow(/not allowed/i);
  });

  it("an all-accounts user may enter any brand", async () => {
    const seen = await runWithTenant(ACCOUNT_B, ADMIN_ID, () => getActiveAccountId());
    expect(seen).toBe(ACCOUNT_B);
  });

  it("cookie fallback intact: OUTSIDE the override the injected account does not leak", async () => {
    // With no override AND no request cookies (vitest), getActiveAccountId takes
    // the cookie path — which can't resolve here, so it must NOT return ACCOUNT_A.
    await expect(getActiveAccountId()).rejects.toBeDefined();
  });
});

describe("MCP tools — brand scoping for a restricted user", () => {
  it("list_brands returns ONLY the user's allowed brand", async () => {
    const tools = loadTools();
    const res = await runWithMcpActor(
      { user: restricted, tokenId: "t" },
      () => tools.get("list_brands")!({}, {}),
    );
    const out = JSON.parse(res.content[0].text);
    expect(out.brands.map((b: { id: string }) => b.id)).toEqual([ACCOUNT_A]);
  });

  it("get_kpis with no brand defaults to the single allowed brand and returns its numbers", async () => {
    const tools = loadTools();
    const res = await runWithMcpActor(
      { user: restricted, tokenId: "t" },
      () => tools.get("get_kpis")!({}, {}),
    );
    const out = parse(res);
    expect(out.brand.id).toBe(ACCOUNT_A);
    // Fixture Account A non-excluded spend = 400 (see tests/db/fixtures.ts).
    expect(out.totals.spend).toBe(400);
  });

  it("get_kpis for a brand the user lacks → error result (never Account B data)", async () => {
    const tools = loadTools();
    const res = await runWithMcpActor(
      { user: restricted, tokenId: "t" },
      () => tools.get("get_kpis")!({ brand: "Account B" }, {}),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Unknown brand|allowed brands/i);
  });

  it("allowedAccountsForUser mirrors the scoping (belt-and-braces)", async () => {
    const brands = await allowedAccountsForUser(restricted);
    expect(brands.map((b) => b.id)).toEqual([ACCOUNT_A]);
  });
});
