# Tenancy, membership and permissions

> **Read this file before changing this domain.** CLAUDE.md carries the
> sharpest invariants; everything below is the full set plus the history
> that produced them. The history is MOVED VERBATIM from CLAUDE.md's old
> Learned section — if it disagrees with the invariants above it, the
> invariants win and the history is telling you why the rule exists.

## Invariants

- Every tenant read injects `account_id`; every write stamps it.
- **Membership says WHERE, permissions say WHAT.** Admins bypass both.
- **A FK target must be re-validated against the active account before a
  write** — the FK only enforces global existence.
- `creative_angles` has no `account_id`: angle rename/delete cascades MUST be
  bounded by a `creatives WHERE account_id` subquery.
- Zero allowed brands throws `NO_BRAND_ACCESS`, which the dashboard layout
  pre-empts before any tenant query runs.
- Permissions DERIVE from `PERMISSION_GROUPS`; every mutating action or route
  calls `requirePermission`. **UI gating is UX-only** — the server is the gate.
- The upload commit uses the account pinned on the validation session at
  validate time, so a mid-flow brand switch cannot cross-write.

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
