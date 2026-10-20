import { describe, expect, it } from "vitest";
import * as comments from "@/lib/comments";

/**
 * D1 (user decision, 2026-10-20) — a typed or pasted "@Full Name" that matches
 * EXACTLY ONE member is recognised by the COMPOSER as that member. Two members
 * with that name: not recognised — the picker chooses. The server is
 * unchanged: it takes explicit ids only.
 */

const ALI = { id: "1", name: "Ali" };
const ALI_HASSAN = { id: "2", name: "Ali Hassan" };
const SARA_1 = { id: "3", name: "Sara Khan" };
const SARA_2 = { id: "4", name: "Sara Khan" };
const ABD_AR = { id: "5", name: "عبد السلام غزال" };
const MEMBERS = [ALI, ALI_HASSAN, SARA_1, SARA_2, ABD_AR];

const resolve = (body: string, picked: Array<{ id: string; name: string }> = [], members = MEMBERS) =>
  comments.resolveComposerMentions(body, picked, members).map((m) => m.id);

describe("D1 — the composer recognises an exact, single-member whole name", () => {
  it("a typed full name registers that member, with no pick", () => {
    expect(resolve("can you check @Ali Hassan please")).toEqual(["2"]);
  });

  it("a name two members share is NOT recognised — the picker chooses", () => {
    expect(resolve("@Sara Khan look")).toEqual([]);
    // …and once one of them is PICKED, that one counts.
    expect(resolve("@Sara Khan look", [SARA_2])).toEqual(["4"]);
  });

  it("prefix collisions resolve to the WHOLE name, never the shorter one", () => {
    expect(resolve("@Ali Hassan and @Ali")).toEqual(["2", "1"]);
    expect(resolve("@Ali Hassan only")).toEqual(["2"]);
    // A PICKED "Ali" doesn't ride along inside "@Ali Hassan".
    expect(resolve("@Ali Hassan only", [ALI])).toEqual(["2"]);
    expect(resolve("@Alice no")).toEqual([]);
  });

  it("is EXACT — case and partial names don't count", () => {
    expect(resolve("@ali hassan")).toEqual([]);
    expect(resolve("@Ali Hass")).toEqual(["1"]); // "@Ali" then " Hass…" — Ali is a whole word
  });

  it("recognises Arabic names, in Arabic and in English text", () => {
    expect(resolve("شكرا @عبد السلام غزال على المراجعة")).toEqual(["5"]);
    expect(resolve("Thanks @عبد السلام غزال!")).toEqual(["5"]);
  });

  it("works on PASTED text — several mentions, across lines, in order of appearance", () => {
    const pasted = "Notes from the call:\n- @Ali Hassan owns the cut\n- @عبد السلام غزال signs off\n@Sara Khan (which one?)";
    expect(resolve(pasted)).toEqual(["2", "5"]);
  });

  it("without the member list it falls back to the explicit picks alone", () => {
    expect(comments.resolveComposerMentions("@Ali Hassan hi", [ALI_HASSAN], null).map((m) => m.id)).toEqual(["2"]);
    expect(comments.resolveComposerMentions("@Ali Hassan hi", [], null)).toEqual([]);
  });
});
