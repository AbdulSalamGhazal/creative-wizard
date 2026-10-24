# Tenancy, membership and permissions

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- Every tenant read injects `account_id`; every write stamps it.
- **The signed-in person's `users` row is read ONCE per request** (W2-5,
  2026-10): `auth()` selects the identity AND the raw preferences
  (`preferred_date_range`, `include_excluded`, `toast_scope`) in one query;
  `sessionPrefs()` hands them to the getters in `db/queries/user-prefs.ts`,
  which decode them and never read the row again. The prefs stay OFF
  `SessionUser`, which client components receive. A test that mocks `auth`
  must mock `sessionPrefs` too (tests/db/session-row.test.ts pins the wiring).
- **Membership says WHERE, permissions say WHAT.** Admins bypass both.
- **A FK target must be re-validated against the active account before a
  write** — the FK only enforces global existence.
- `creative_angles` has no `account_id`: angle rename/delete cascades MUST be
  bounded by a `creatives WHERE account_id` subquery.
- Zero allowed brands throws `NO_BRAND_ACCESS`, which the dashboard layout
  pre-empts before any tenant query runs.
- Permissions DERIVE from `PERMISSION_GROUPS`; every mutating action or route
  calls `requirePermission`. **UI gating is UX-only** — the server is the gate.
- **Below admin, "Manage users & access" works WITHIN the manager's own
  access (D1, 2026-10-23).** ONE guard — `teamGuard` in `lib/team-guard.ts`
  — runs on every Team write: invite, access (role + permissions), brands,
  password reset and the avatar admin path (`removeUserAvatar` and
  `POST /api/uploads/avatar` with someone else's `userId`). A non-admin
  holder: never makes an admin and never changes an admin's access, brands,
  password or photo; switches on OR off only permissions they hold
  themselves (judged on EFFECTIVE sets, so a preset is judged by what it
  grants; anything else on the person stays exactly as it was); if
  restricted to some brands, grants or removes only those brands, never
  "every brand", and can't narrow an every-brand member; and sets a
  password only for someone whose whole access (permissions AND brands) is
  within theirs — a reset is a takeover. Admins pass every check; the
  self-edit and last-admin rules stay in the actions. Each refusal is a
  sentence from `TEAM_REFUSAL` / `grantRefusal` / `removeRefusal`. The Team
  page calls the SAME function to hide or grey out what the manager can't
  use (`managerScope` / `memberAccess` in `db/queries/team.ts` feed it), so
  the UI never offers what the server refuses — but the server stays the
  gate. Pinned by `tests/db/team-guard.test.ts` (every path, real actions,
  pool size 1) and `lib/team-guard.test.ts`.
- The upload commit uses the account pinned on the validation session at
  validate time, so a mid-flow brand switch cannot cross-write.
- **Ending sessions is one stamp, not a cookie change (D3).** A cookie
  issued before `users.sessions_revoked_at` is signed out by `auth()`.
  "Sign out" ends THIS device only and stamps nothing; "Sign out
  everywhere" ends EVERY session of the person (F2, user decision — two
  menu items, audited `auth.signout` / `auth.signout_everywhere`); a
  password change ends the others and re-issues the current cookie; an
  admin reset ends all of the target's. Middleware stays DB-free — never
  move this check there.
- **An event with no session passes its brand explicitly.** `logAudit`
  resolves the ACTIVE brand, which throws `NO_BRAND_ACCESS` for a visitor who
  isn't signed in — and the audit swallows its own errors, so the row simply
  vanishes. Anonymous auth events (`auth.signin_failed`,
  `auth.signin_throttled`) are filed under the OLDEST brand
  (`oldestAccountId()`); the sign-in throttle counts those rows (D2).
- **The sign-in throttle keys on (email, network address)** (F1, 2026-10-24):
  5 failures from one address in 15 minutes and that address waits, with
  "Too many attempts — try again in 15 minutes." Unknown emails are throttled
  the same way. The address is `clientIp()` (first `x-forwarded-for` hop,
  else `x-real-ip`) stored as `meta.ip`; with NO address the count is the
  email across every address — never relax that fallback into a fresh key.

## History and rationale

*Moved verbatim from CLAUDE.md (2026-10). Line references are to the file
as it stood before the restructure.*

### Multi-tenancy + brand membership

<!-- was CLAUDE.md L707–761 -->

- **Multi-tenancy = row-level `account_id`, scoped in the query/action layer;
  brand membership IS enforced at tenant resolution (2026-07).** The app manages
  2–5 brands from one DB; the active brand is the `ccms_account` cookie, resolved
  per request by the cache()-deduped `getActiveAccountId()` / `listAccounts()` /
  `getActiveAccount()` in `lib/tenant.ts` (mirrors `auth()`). **Brand membership
  gates which brands a user may see** (permissions say WHAT, membership says
  WHERE): `users.all_accounts = true` (default/legacy) → member of EVERY brand,
  **including brands created later**; `false` → only the brands in the
  `user_accounts` join table. **Admins are always effectively all-accounts**
  (code bypass, like the permission bypass). The pure resolution logic lives in
  `lib/account-access.ts` (`allowedAccountIds` + `resolveActiveAccountId`), fed
  live data by `lib/tenant.ts`: `listAccounts()` returns only ALLOWED brands (so
  the `AccountSwitcher`, the **Brands** tab, and `setActiveAccount`'s validation
  all enforce membership), and `getActiveAccountId()` returns the cookie's brand
  only when it's ALLOWED — a forged/stale cookie deterministically falls back to
  the user's first allowed brand (NOT an error), and **zero allowed brands throws
  `NO_BRAND_ACCESS`**, which the dashboard layout pre-empts with the full-page
  "No brand access" screen BEFORE any tenant query runs. `listAllAccounts()` is
  the UNFILTERED list (the Team admin, whose `users.manage` editor may grant any
  brand; the slug-uniqueness / grant-validation checks). Membership is managed on
  the **Team** page (`updateUserBrands` / invite in `app/actions/user.ts`, audited
  `user.brands_update`); `createAccount` auto-grants a restricted creator
  membership to the new brand in-transaction. `setActiveAccount`/`createAccount`/
  `renameAccount`/`setStatusWindow` (the last two now gated to an allowed brand)
  live in `app/actions/account.ts`. The upload validate→commit flow needs no
  membership change — commit uses the account pinned on the validation session at
  validate time (allowed then). Migration **0027** (additive: `all_accounts` NOT
  NULL DEFAULT true + `user_accounts` — existing users keep today's every-brand
  behavior). Every tenant table carries `account_id`
  (FK → `accounts`, DEFAULT the Urjwan id `00000000-0000-0000-0000-000000000001`):
  products, creatives, angles, performance_records, upload_batches,
  upload_validation_sessions, summary_views, platform_field_mappings,
  audit_events, rating_rules (PK = account_id), platform_rating_rules
  (PK = (account_id, platform)). `creative_angles` has NO `account_id` — it's
  scoped transitively via its creative, so angle rename/delete **cascades must be
  bounded by a `creatives WHERE account_id` subquery** (else a shared angle string
  hits other brands). Reads: every `db/queries/*` condition-builder injects one
  `eq(table.accountId, await getActiveAccountId())`; writes: actions/routes stamp
  `accountId` on inserts and scope updates/deletes. The upload pipeline stores
  the account on the validation session and commits under THAT account (a
  mid-flow switch can't cross-write). `logAudit` stamps `account_id` (override
  param for the session-scoped upload audits). Single-account behaviour is
  unchanged because the filter = the only account = all rows. Migrations: **0013**
  (additive: accounts + `account_id` NOT NULL DEFAULT Urjwan + composite uniques —
  backward-compatible, deploy-safe alone) and **0014** (rating PK restructure —
  NOT backward-compatible: drops `rating_rules.id`, so it must land WITH the code,
  not before/after). Both applied to prod. To add a tenant table: add
  `accountId: accountId()`, scope its queries + writes, prefix any unique index
  with `account_id`. **A foreign-key target must be re-validated against the
  active account before a write** — the FK only enforces global existence
  (`creatives.product_id → products.id` is NOT a composite `(account_id,
  product_id)` FK), so an action writing a caller-supplied id must first look it
  up scoped to the account (see `productInAccount` in `app/actions/creative.ts`;
  the bulk-create path does the equivalent via an account-scoped name map). A
  multi-agent audit caught this on create/patchCreative after the initial ship.

### Granular per-user permissions

<!-- was CLAUDE.md L1346–1384 -->

- **Authorization is GRANULAR per-user permissions (2026-07) — DERIVE from the
  catalog, never re-list.** The old two-tier `requireEditor`/`requireAdmin` model
  is GONE. `lib/permissions.ts` is the single source of truth: `PERMISSION_GROUPS`
  (an `as const` catalog of 6 groups / 24 keys) → the `Permission` union +
  `ALL_PERMISSIONS` are derived from it, so any new capability is added in ONE
  place and every surface (checks, the Team UI, nav) follows.
  - **Storage:** `users.role` (`admin` | `editor` | `viewer`, a tier) +
    `users.permissions text[]` NULLABLE (migration 0026, additive). `NULL` →
    derive from the role preset; a non-null array → an explicit ("Custom") grant.
    `resolvePermissions(role, permissions)`: admin → ALL; null → preset; array →
    the filtered explicit set (role tier is cosmetic below admin when the array
    is present). Presets: admin = everything, editor = `EDITOR_PRESET` (today's
    old `requireEditor` set EXACTLY — creative/campaign CRUD, import/upsert/
    cleanup, exclude), viewer = none.
  - **Enforcement (the server IS the boundary):** every mutating action/route
    calls `requirePermission(<perm>)` from `lib/auth.ts` (throws otherwise);
    admins bypass via `can()`. The 3 upload routes: validate/commit →
    `upload.import`, and re-check `upload.upsert` when `upsert` is on;
    thumbnail → `creative.edit`. `can(user, perm)` is pure+sync so Server
    Components gate rendered UI with it.
  - **UI gating is UX-only (hide, don't disable-only).** A `PermissionsProvider`
    (`components/auth/permissions-context.tsx`) seeded from the layout exposes
    `useCan(perm)` to Client Components; server pages/danger-zones gate with
    `can(user, perm)`. Nav derives visibility via `visibleNavItems()` in
    `nav-items.ts` (per-item `perms`, shown if the user holds ANY). Never rely on
    hidden UI for security — the action/route check is the real gate.
  - **The unified Team page** (`/admin/users`, `users.manage`) is the ONE place
    to add people and manage access — invite form on top, then one
    `UserAccessCard` per member (`components/user/user-access-card.tsx`) that owns
    role+permissions AND password reset. The card: preset selector (Admin/Editor/
    Viewer/Custom) + group checkbox grids + a dirty Save/Discard bar +
    `AdminSetPasswordButton`; admin cards render all-checked+disabled; you can't
    edit your OWN access. `updateUserAccess` in `app/actions/user.ts` enforces the
    guardrails (no self-edit, can't demote the last admin) and audits
    `user.permissions_update` with before/after `{role, permissions}`. The invite
    flow accepts `viewer` too. (`/admin/access` is a redirect stub → `/admin/users`;
    the old per-row `UserRoleSelect` + `updateUserRole` were removed — the card's
    preset selector supersedes them.)

### "Manage users & access" was admin-equivalent (D1, 2026-10-23)

The 2026-10-23 system audit (B-01) found that every Team mutation checked
only `requirePermission("users.manage")`. A non-admin holder could invite
`role: "admin"`, promote anyone to admin, reset the admin's password (and
sign in as them — the audit row was the only trace), and hand out
permissions and brands they never had: a restricted holder could invite an
every-brand user. Nothing in the catalog label ("Manage users & access") or
the docs said the permission equalled admin. The user chose option (a) of
three — enforce "you can't grant what you don't hold" — over making it
admin-only or removing it.

The fix is the invariant above: one pure guard, used by the five write paths
and by the Team page's components, so the two can't disagree. Two choices
in it went past the letter of the decision and are flagged for the user:
a holder can't REMOVE a permission or brand they don't hold either (a
manager works inside their own scope in both directions), and below admin a
password can be set only for someone whose access is within the
manager's — not just "never an admin's" — because a reset hands the
manager that person's access. This supersedes the history above that says
"a `users.manage` editor may grant any brand": the Team page still LISTS
every brand (so a card shows the person's real brands), but a restricted
manager's invite offers only their own, and brands they don't belong to are
greyed out on every card.

The scratch tests that proved the escalations were ported into
`tests/db/team-guard.test.ts`: 19 of its 33 cases failed before the guard
(every refusal) and all pass after.

### The sign-in throttle that never existed (D2, 2026-10-23)

Tech-spec had described a sign-in throttle since 2026-09 — five failures per
email in fifteen minutes, counted from `auth.signin_failed` rows — and a DB
test "pinned" it. The audit (B-02) found two things wrong at once. `signIn`
never counted anything: the commit that claimed the throttle only added an
import, and the test re-implemented the counter against rows it inserted
itself, so it passed with no feature behind it. And the rows it would have
counted were never written: `logAudit` looked up the active brand, which
throws for a visitor with no session, and swallowed the error. The local dev
database held exactly one `auth.signin_failed` row, from before tenancy.

The user decided anonymous attempts file under the oldest brand. The throttle
now runs first in `signIn` — before the user lookup and the password check —
and the test drives the real action with an empty cookie jar and the real
tenant module, so it fails the way production failed (4 of its 7 cases fail
on the old action). The lesson generalizes beyond auth: a test that copies the
code under test proves the copy.

**Per address (F1, 2026-10-24).** Reviewing D2 surfaced the cost of keying
on the email alone: anyone could lock anyone out for 15 minutes by typing
their email five times. The user chose to count per (email, network
address) — the address Vercel reports in `x-forwarded-for` / `x-real-ip`,
stored on each failure as `meta.ip` and counted through a new partial
expression index (migration 0059) — and to say so when it happens: a
throttled attempt reads "Too many attempts — try again in 15 minutes."
instead of the generic wrong-password sentence. Unknown emails throttle the
same way, so the sentence reveals nothing. When the host reports no address,
the count falls back to the email across every address. The trade-off that
comes with it: five guesses per address per window, so many addresses buy
many guesses; bcrypt and the generic wrong-password message remain the
other half of the defence.

### Sessions that could not be ended (D3, 2026-10-23)

The session cookie is stateless — `<userId>.<issuedAtMs>.<hmac>` — which
keeps the Edge middleware DB-free but meant nothing could end a session
before its 30 days ran out. Signing out deleted only that browser's cookie;
changing a password, or an admin resetting it (the documented recovery from
a leaked session), left every existing cookie working (audit B-19). The user
chose to fix it: one nullable column, `sessions_revoked_at`, compared with
the cookie's own signed issued-at inside `auth()`. No cookie-format change,
so nobody was signed out by the deploy. Sign-out now means "sign out
everywhere" (the decision's wording: sign-out, password change and admin
reset end the person's other sessions); the password change re-issues the
current device's cookie so the person who changed it stays in. Pinned
through the real actions in `tests/db/sessions.test.ts` (4 of its 6 cases
fail on the old code).

**Two sign-outs (F2, 2026-10-24).** Making the one "Sign out" end every
session changed what a familiar button does without changing its label —
signing out of a shared laptop also signed you out of your phone. The user
chose two items: "Sign out" is this device again (it clears the cookie and
stamps nothing), and a new "Sign out everywhere" in the avatar menu is the
D3 behaviour. The password change and the admin reset are unchanged. Each
sign-out audits under its own action, and the two-device test in
`tests/db/sessions.test.ts` pins both (3 of its 7 cases fail on the D3
code).

