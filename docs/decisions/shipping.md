# Shipping — how a change reaches `main` and production

## Invariants

- There are NO pull requests. `gh` is not installed and nothing is signed in
  to GitHub; never ask the user for `gh`, a token or a GitHub login.
- ONE session lands work: the session titled **Commit Master**. No other
  session commits on `main`, merges into it, or runs `git push`.
- Every other session works in its own worktree on its own named branch and
  talks to Commit Master directly — `START` before the first edit, `DONE`
  when the work is committed (the message formats are in `CLAUDE.md`,
  Deployment). The user is not the messenger.
- Commit Master lands ONE session's series at a time, each rebased on the
  current `main`, so every series is checked against what the previous one
  changed.
- The overlap check covers the same files AND different files that collide in
  meaning — a shared helper, the schema, a doc section, a test guard. An
  overlap is reported to the user, never resolved silently.
- The gates run on the COMBINED result, whatever a session's `DONE` claimed.
- Pushing `main` deploys production. Commit Master has the user's STANDING
  go-ahead to push without asking when the gates are green and the overlap
  check is clean. It STOPS and asks the user for: an overlap, a failed gate,
  or a series that adds a migration (migrations are run by hand, before the
  deploy).
- A series that touches only `*.md` needs `npx vitest run` alone — and it
  does need it: `docs/decisions-map.test.ts` reads these files.

## Commit Master's steps

1. On `START`: compare the named area with every live session's area; reply
   only to object.
2. On `DONE`: in the main checkout, `git status` clean; rebase the branch on
   the current `main`; run the overlap check against everything landed or in
   flight since the branch was cut.
3. Fast-forward it in: `git merge --ff-only <branch>`.
4. Gates:
   `DATABASE_URL='postgres://ccms:x@127.0.0.1:1/unreachable' npx next build`
   — check the EXIT CODE and grep the full log for `failed to compile|Error:`
   (the override keeps `.env.production.local`'s live URL out of the build);
   `npx vitest run` and `npm run test:db` green.
5. `git push origin main`.
6. Confirm with `GET https://creative.urjwan.com/api/health` until `commit`
   equals the pushed short sha.
7. Tell the session and the user what landed.

"One feature per session" in Workflow means one feature per COMMIT SERIES,
reviewed in the session — not a GitHub PR.

## History and rationale

- **2026-10-25 — no pull requests.** The project never used GitHub PRs and no
  commit on `main` came through one; a session that asked the user for `gh`
  was asking for something that does not exist here. The house way was
  written down: fast-forward, build with an unreachable `DATABASE_URL`, both
  test suites, the user's go-ahead, push, health check.
- **2026-11-20 — one lander.** Several sessions working at once each merged
  and pushed `main` on their own, with nobody checking one session's work
  against another's. The user made one session — Commit Master — the only
  path to `main`, then removed themselves as the messenger: sessions announce
  their branch and area at the start, report at the end, and Commit Master
  pushes on a standing go-ahead when everything is clean.
- **2026-11-20 — docs-only still runs the unit suite.** The commit that
  introduced the Commit Master rule was pushed without any gate "because it
  only changes `CLAUDE.md`", and it took `CLAUDE.md` past the 600-line
  ceiling pinned by `docs/decisions-map.test.ts` — `main` carried a failing
  unit test until the rules moved into this file.
