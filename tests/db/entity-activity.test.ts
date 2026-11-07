import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * An entity's Activity (2026-11-07): the audit events linked to it, newest
 * first, paged — brand-scoped — and its derived went-live / stopped events,
 * by the status badge's own inputs (spend > 0, not excluded).
 */
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { entityActivityPage, entityStatusEvents } from "@/db/queries/entity-activity";
import { ENTITY_ACTIVITY_PAGE } from "@/lib/entity-activity";
import { CAMPAIGN_1, CREATIVE_1, CREATIVE_B, resetAndSeed } from "./fixtures";

const ADMIN = "11111111-1111-1111-1111-111111111111";

beforeEach(async () => {
  await resetAndSeed();
});

async function audit(accountId: string, touches: { creative?: string[]; campaign?: string[] }, n = 1) {
  for (let i = 0; i < n; i++) {
    await writeAudit(db, {
      accountId,
      action: AUDIT_ACTIONS.UPLOAD_COMMIT,
      entityType: "upload",
      entityId: `batch-${i}`,
      entityLabel: `upload ${i}`,
      actorUserId: ADMIN,
      meta: { platform: "instagram", rowsImported: i },
      touches,
    });
  }
}

describe("entityActivityPage", () => {
  it("lists the events that touched the entity, newest first, with the actor", async () => {
    await audit(ACCOUNT_A, { creative: [CREATIVE_1] }, 2);
    await audit(ACCOUNT_A, { campaign: [CAMPAIGN_1] }); // not this creative

    const page = await entityActivityPage("creative", CREATIVE_1, null);
    expect(page.rows.map((r) => r.entityLabel)).toEqual(["upload 1", "upload 0"]);
    expect(page.rows[0]!.actor?.id).toBe(ADMIN);
    expect(page.hasMore).toBe(false);
  });

  it("pages by event id", async () => {
    await audit(ACCOUNT_A, { creative: [CREATIVE_1] }, ENTITY_ACTIVITY_PAGE + 2);
    const first = await entityActivityPage("creative", CREATIVE_1, null);
    expect(first.rows).toHaveLength(ENTITY_ACTIVITY_PAGE);
    expect(first.hasMore).toBe(true);
    const second = await entityActivityPage("creative", CREATIVE_1, first.rows.at(-1)!.id);
    expect(second.rows).toHaveLength(2);
    expect(second.hasMore).toBe(false);
  });

  it("never shows another brand's events", async () => {
    await audit(ACCOUNT_B, { creative: [CREATIVE_B] });
    await audit(ACCOUNT_B, { creative: [CREATIVE_1] }); // a forged link in brand B
    expect((await entityActivityPage("creative", CREATIVE_B, null)).rows).toEqual([]);
    expect((await entityActivityPage("creative", CREATIVE_1, null)).rows).toEqual([]);
  });
});

describe("entityStatusEvents", () => {
  it("derives went live from the creative's spend days; a budget month has none", async () => {
    const events = await entityStatusEvents("creative", CREATIVE_1);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === "live")).toBe(true);
    expect(await entityStatusEvents("budget_month", "2026-01")).toEqual([]);
  });
});

describe("GET /api/entity-activity", () => {
  it("phrases rows on the server and refuses a malformed id", async () => {
    vi.doMock("@/lib/auth", async (orig) => ({
      ...(await orig<typeof import("@/lib/auth")>()),
      auth: vi.fn(async () => ({ id: ADMIN, role: "admin" })),
    }));
    const { GET } = await import("@/app/api/entity-activity/route");
    await audit(ACCOUNT_A, { creative: [CREATIVE_1] });

    const ok = await GET(
      new NextRequest(`http://localhost/api/entity-activity?type=creative&id=${CREATIVE_1}`),
    );
    const body = (await ok.json()) as {
      rows: Array<{ label: string; about: string | null; summary: string | null }>;
      status: unknown[] | null;
    };
    expect(body.rows[0]).toMatchObject({ label: "Committed upload", about: "upload 0" });
    expect(Array.isArray(body.status)).toBe(true);

    const bad = await GET(new NextRequest("http://localhost/api/entity-activity?type=creative&id=nope"));
    expect(bad.status).toBe(400);
  });
});
