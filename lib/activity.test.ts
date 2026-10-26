import { describe, expect, it } from "vitest";
import { COMMENT_ANCHOR_TYPES } from "@/lib/comments";
import {
  ACTIVITY_WHO,
  ACTIVITY_WHO_LABEL,
  ANCHOR_FALLBACK_LABEL,
  ANCHOR_TYPE_LABEL,
  activityHref,
  activityQuery,
  isActivityFiltered,
  type ActivityParams,
} from "@/lib/activity";
import { PAGE_REFUSAL_GATES, refusedRoutes } from "@/lib/page-gates";
import { activityParamsSchema } from "@/validators/activity";

const DEFAULT: ActivityParams = { who: "all", types: [], q: "", page: 1 };

describe("labels derive from the vocabulary", () => {
  it("every anchor type has a chip label and a fallback; every who a label", () => {
    for (const type of COMMENT_ANCHOR_TYPES) {
      expect(ANCHOR_TYPE_LABEL[type]).toBeTruthy();
      expect(ANCHOR_FALLBACK_LABEL[type]).toBeTruthy();
    }
    for (const who of ACTIVITY_WHO) expect(ACTIVITY_WHO_LABEL[who]).toBeTruthy();
  });
});

describe("the URL is the state", () => {
  it("the default view is the bare path", () => {
    expect(activityQuery(DEFAULT)).toBe("");
    expect(activityHref(DEFAULT)).toBe("/activity");
  });

  it("writes only what differs from the default, and the schema reads it back", () => {
    const params: ActivityParams = { who: "me", types: ["creative", "view"], q: "hook", page: 3 };
    const query = activityQuery(params);
    expect(query).toBe("who=me&types=creative%2Cview&q=hook&page=3");
    expect(
      activityParamsSchema.parse(Object.fromEntries(new URLSearchParams(query))),
    ).toEqual(params);
  });

  it("the schema falls back field by field — never throws, never empties the lot", () => {
    expect(
      activityParamsSchema.parse({
        who: "them",
        types: "creative,bogus",
        page: "x",
        q: ["a", "b"],
      }),
    ).toEqual({ who: "all", types: ["creative"], page: 1, q: "" });
    expect(activityParamsSchema.parse({})).toEqual(DEFAULT);
    expect(activityParamsSchema.parse({ q: "  needle " }).q).toBe("needle");
  });

  it("Everyone/Mine is not a filter; a type or a search is", () => {
    expect(isActivityFiltered(DEFAULT)).toBe(false);
    expect(isActivityFiltered({ ...DEFAULT, who: "me" })).toBe(false);
    expect(isActivityFiltered({ ...DEFAULT, types: ["view"] })).toBe(true);
    expect(isActivityFiltered({ ...DEFAULT, q: "x" })).toBe(true);
  });
});

describe("refusedRoutes — the pages whose PAGE refuses, not the sidebar's gate", () => {
  it("a member holding nothing is refused every gated page", () => {
    expect(refusedRoutes(() => false)).toEqual(Object.keys(PAGE_REFUSAL_GATES));
  });

  it("users.manage opens Team only", () => {
    expect(refusedRoutes((p) => p === "users.manage")).toEqual([
      "/admin/catalog",
      "/admin/audit",
    ]);
  });

  it("ANY Configuration tab opens Configuration", () => {
    expect(refusedRoutes((p) => p === "record.exclude")).toEqual([
      "/admin/users",
      "/admin/audit",
    ]);
  });

  it("an admin — every permission — is refused nowhere", () => {
    expect(refusedRoutes(() => true)).toEqual([]);
  });

  it("the upload pages are never refused: their history renders for every member", () => {
    expect(Object.keys(PAGE_REFUSAL_GATES)).not.toContain("/uploads");
    expect(Object.keys(PAGE_REFUSAL_GATES)).not.toContain("/store/uploads");
  });
});
