import type { CommentReactionTally } from "@/lib/comments";

/**
 * OPTIMISTIC REACTIONS (2026-10) — the pure half, so the rules are testable.
 *
 * A reaction used to change nothing until the server answered (~0.4 s), and a
 * second click while waiting toggled it straight back off. Now:
 *
 *  - the pill and its count change on the CLICK (`applyReactionOverrides`
 *    lays the reader's pending choices over the last tallies the server sent);
 *  - writes are SERIALISED per (comment, kind) and COALESCED: at most one
 *    request is in flight for a key, and when it lands, if the reader's latest
 *    choice differs from what the server now holds, ONE more request carries
 *    it. A burst of clicks therefore ends in the state the reader LAST chose,
 *    with at most two requests — never a queue of toggles flip-flopping;
 *  - a failure rolls the pill back to what the server holds and says so.
 *
 * The server half is `setReaction` (the client sends ON or OFF, never
 * "toggle"), which is idempotent, so a retry or a replay cannot drift either.
 * Nothing here knows how many kinds exist — it serves the whole vocabulary.
 */

/** Pending choices for one comment: kind → the state the reader wants. */
export type ReactionOverrides = ReadonlyMap<string, boolean>;

/**
 * The tallies to SHOW: the server's, with the reader's pending choices laid
 * over them. Pure. A kind the reader adds that nobody had yet is appended (the
 * server orders kinds by their first reaction, so a new one lands last there
 * too); a kind whose count falls to zero disappears, as the server would drop
 * it. The tooltip names are left as the server sent them until the thread
 * reloads — the count and the tint are what move on a click.
 */
export function applyReactionOverrides(
  tallies: readonly CommentReactionTally[],
  overrides: ReactionOverrides | undefined,
): CommentReactionTally[] {
  if (!overrides || overrides.size === 0) return [...tallies];
  const out: CommentReactionTally[] = [];
  for (const tally of tallies) {
    const want = overrides.get(tally.kind);
    if (want === undefined || want === tally.mine) {
      out.push(tally);
      continue;
    }
    const count = tally.count + (want ? 1 : -1);
    if (count > 0) out.push({ ...tally, count, mine: want });
  }
  for (const [kind, want] of overrides) {
    if (want && !tallies.some((t) => t.kind === kind)) {
      out.push({ kind, count: 1, mine: true, names: [] });
    }
  }
  return out;
}

export interface ReactionWriteResult {
  ok: boolean;
  error?: string;
  stale?: boolean;
}

export interface ReactionSyncHooks {
  /** Send the reader's wanted state. Must not reject (wrap in `safeAction`). */
  send: (commentId: string, kind: string, on: boolean) => Promise<ReactionWriteResult>;
  /** Something visible changed — re-render. */
  onChange: () => void;
  /** A write failed; the pill has already been rolled back. */
  onError: (result: ReactionWriteResult) => void;
  /** A key has no request in flight and nothing left to send — reload the thread. */
  onSettled: () => void;
}

/** A comment id is a uuid and a kind a short key — neither contains ":". */
const SEP = ":";
const keyOf = (commentId: string, kind: string) => `${commentId}${SEP}${kind}`;

/**
 * The write queue. One instance per thread; keys are (comment, kind).
 *
 * `desired` is what the reader last asked for — it IS the display override.
 * `confirmed` is what the server holds as far as this tab knows: seeded from
 * the tallies on the first click, advanced by every successful write.
 */
export class ReactionSync {
  private readonly desired = new Map<string, boolean>();
  private readonly confirmed = new Map<string, boolean>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly hooks: ReactionSyncHooks) {}

  /** The reader chose `on` for (comment, kind); `serverMine` is what the thread shows from the server. */
  choose(commentId: string, kind: string, on: boolean, serverMine: boolean): void {
    const key = keyOf(commentId, kind);
    if (!this.confirmed.has(key)) this.confirmed.set(key, serverMine);
    this.desired.set(key, on);
    this.hooks.onChange();
    void this.pump(commentId, kind);
  }

  /** The pending choices for one comment — feed to `applyReactionOverrides`. */
  overridesFor(commentId: string): Map<string, boolean> | undefined {
    let out: Map<string, boolean> | undefined;
    const prefix = `${commentId}${SEP}`;
    for (const [key, want] of this.desired) {
      if (!key.startsWith(prefix)) continue;
      (out ??= new Map()).set(key.slice(prefix.length), want);
    }
    return out;
  }

  /** Is anything still waiting on the server? */
  get busy(): boolean {
    return this.inFlight.size > 0;
  }

  /**
   * A fresh thread arrived from the server. Every key with nothing in flight is
   * settled — drop it, so the server's tallies (which now include it, and
   * anyone else's reactions) rule again. A key still in flight keeps its
   * override, or the pill would flicker back for the length of the request.
   */
  reconcile(): void {
    for (const key of [...this.desired.keys()]) {
      if (this.inFlight.has(key)) continue;
      if (this.desired.get(key) !== this.confirmed.get(key)) continue;
      this.desired.delete(key);
      this.confirmed.delete(key);
    }
  }

  private async pump(commentId: string, kind: string): Promise<void> {
    const key = keyOf(commentId, kind);
    if (this.inFlight.has(key)) return; // the landing request picks the latest choice up
    const want = this.desired.get(key);
    if (want === undefined) return;
    if (want === this.confirmed.get(key)) {
      // Clicked back to where the server already is: nothing to send.
      this.hooks.onSettled();
      return;
    }

    this.inFlight.add(key);
    const result = await this.hooks.send(commentId, kind, want);
    this.inFlight.delete(key);

    if (!result.ok) {
      // Roll back to the last state the server confirmed. Clicks made while
      // this was in flight are dropped with it — the failure is the news, and
      // replaying them against a server that just refused would be a guess.
      const held = this.confirmed.get(key);
      if (held === undefined) this.desired.delete(key);
      else this.desired.set(key, held);
      this.hooks.onChange();
      this.hooks.onError(result);
      this.hooks.onSettled();
      return;
    }

    this.confirmed.set(key, want);
    if (this.desired.get(key) !== want) {
      // The reader changed their mind while this was in flight: carry the
      // LATEST choice — one more request, however many clicks there were.
      void this.pump(commentId, kind);
      return;
    }
    this.hooks.onSettled();
  }
}
