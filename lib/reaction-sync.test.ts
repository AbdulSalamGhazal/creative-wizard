import { describe, expect, it } from "vitest";
import { ReactionSync, applyReactionOverrides, type ReactionWriteResult } from "@/lib/reaction-sync";
import type { CommentReactionTally } from "@/lib/comments";

const tally = (kind: string, count: number, mine: boolean): CommentReactionTally => ({
  kind,
  count,
  mine,
  names: [],
});

describe("applyReactionOverrides — what the pill shows on the click", () => {
  const server = [tally("up", 2, false), tally("heart", 1, true)];

  it("adds yours to an existing kind, tinted, and takes yours off one you had", () => {
    const shown = applyReactionOverrides(
      server,
      new Map([
        ["up", true],
        ["heart", false],
      ]),
    );
    expect(shown).toEqual([tally("up", 3, true)]); // heart fell to zero and went
  });

  it("appends a kind nobody had yet, last — where the server would put it", () => {
    const shown = applyReactionOverrides(server, new Map([["party", true]]));
    expect(shown.map((t) => [t.kind, t.count, t.mine])).toEqual([
      ["up", 2, false],
      ["heart", 1, true],
      ["party", 1, true],
    ]);
  });

  it("is a no-op where the choice already matches the server, or there is none", () => {
    expect(applyReactionOverrides(server, new Map([["heart", true], ["up", false]]))).toEqual(server);
    expect(applyReactionOverrides(server, undefined)).toEqual(server);
    expect(applyReactionOverrides([], new Map([["wow", false]]))).toEqual([]);
  });
});

/** A send whose answers the test releases by hand, in order. */
function harness(answer: (on: boolean) => ReactionWriteResult = () => ({ ok: true })) {
  const sent: boolean[] = [];
  const pending: Array<() => void> = [];
  const errors: ReactionWriteResult[] = [];
  let settled = 0;
  let changes = 0;
  const sync = new ReactionSync({
    send: (_c, _k, on) =>
      new Promise<ReactionWriteResult>((resolve) => {
        sent.push(on);
        pending.push(() => resolve(answer(on)));
      }),
    onChange: () => (changes += 1),
    onError: (r) => errors.push(r),
    onSettled: () => (settled += 1),
  });
  const release = async () => {
    const next = pending.shift();
    next?.();
    // let the awaiting pump continue
    await new Promise((r) => setTimeout(r, 0));
  };
  return {
    sync,
    sent,
    errors,
    release,
    get settled() {
      return settled;
    },
    get changes() {
      return changes;
    },
  };
}

describe("ReactionSync — a burst of clicks ends where the reader LAST left it", () => {
  it("shows the choice at once, and sends it", async () => {
    const h = harness();
    h.sync.choose("c1", "up", true, false);
    expect(h.sync.overridesFor("c1")).toEqual(new Map([["up", true]]));
    expect(h.changes).toBe(1);
    expect(h.sent).toEqual([true]);
    await h.release();
    expect(h.settled).toBe(1);
    expect(h.sync.busy).toBe(false);
  });

  it("on → off → on → off while the first is in flight = TWO requests, ending OFF", async () => {
    const h = harness();
    h.sync.choose("c1", "up", true, false);
    h.sync.choose("c1", "up", false, false);
    h.sync.choose("c1", "up", true, false);
    h.sync.choose("c1", "up", false, false);
    expect(h.sent).toEqual([true]); // one in flight, the rest coalesce
    expect(h.sync.overridesFor("c1")?.get("up")).toBe(false); // shows the LAST choice
    await h.release(); // server now holds ON; the reader wants OFF
    expect(h.sent).toEqual([true, false]);
    await h.release();
    expect(h.sent).toEqual([true, false]);
    expect(h.settled).toBe(1);
  });

  it("an even burst that ends where it started sends only the first, then nothing", async () => {
    const h = harness();
    h.sync.choose("c1", "up", true, false);
    h.sync.choose("c1", "up", false, false);
    await h.release(); // server ON, reader wants OFF → one more
    expect(h.sent).toEqual([true, false]);
    h.sync.choose("c1", "up", true, false);
    h.sync.choose("c1", "up", false, false);
    await h.release();
    expect(h.sent).toEqual([true, false]); // already OFF on the server
  });

  it("keys are independent — two kinds, two comments, in flight together", () => {
    const h = harness();
    h.sync.choose("c1", "up", true, false);
    h.sync.choose("c1", "heart", true, false);
    h.sync.choose("c2", "up", true, false);
    expect(h.sent).toEqual([true, true, true]);
    expect(h.sync.overridesFor("c1")).toEqual(
      new Map([
        ["up", true],
        ["heart", true],
      ]),
    );
    expect(h.sync.overridesFor("c3")).toBeUndefined();
  });

  it("a failure rolls the pill back to what the server holds, says so, and drops the queued clicks", async () => {
    const h = harness(() => ({ ok: false, error: "That comment was deleted." }));
    h.sync.choose("c1", "up", true, false);
    h.sync.choose("c1", "up", false, false);
    h.sync.choose("c1", "up", true, false);
    await h.release();
    expect(h.errors).toEqual([{ ok: false, error: "That comment was deleted." }]);
    expect(h.sync.overridesFor("c1")?.get("up")).toBe(false); // back to the server's state
    expect(h.sent).toEqual([true]); // nothing replayed against a refusal
    expect(h.settled).toBe(1); // the thread reloads to the truth
  });

  it("a later success after an earlier one is remembered as the server's state", async () => {
    let call = 0;
    const h = harness(() => (++call === 2 ? { ok: false, error: "nope" } : { ok: true }));
    h.sync.choose("c1", "up", true, false);
    h.sync.choose("c1", "up", false, false);
    await h.release(); // ON stored
    await h.release(); // OFF refused → roll back to ON, not to the stale "false" tallies
    expect(h.sync.overridesFor("c1")?.get("up")).toBe(true);
  });

  it("reconcile forgets settled choices once fresh tallies arrive, never one in flight", async () => {
    const h = harness();
    h.sync.choose("c1", "up", true, false);
    h.sync.reconcile();
    expect(h.sync.overridesFor("c1")?.get("up")).toBe(true); // still in flight
    await h.release();
    h.sync.reconcile();
    expect(h.sync.overridesFor("c1")).toBeUndefined();
  });
});
