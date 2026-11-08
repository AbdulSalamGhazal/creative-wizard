# Price Structure

The module that replaces the marketing team's standalone offer-pricing tool
(2026-11): the price structure of every product and offer (customer pays →
net revenue → COGS → marketing → **Clean Money Left**), the ROAS each offer
and each sales mix needs for the team's targets A and B, a plan-vs-actual
check for a past period, and complete, separate **versions** of all of it.
Routes under `/price-structure`; its own tables (`ps_*`), actions, engine and
component folder; three grants (view · edit · versions).

**Its NAME is Pricing (user, 2026-11-08).** Every label a person reads —
the sidebar section, page eyebrows, tab titles ("Pricing · Plan"), the
access refusal, the Team page's permission group, the audit filter — says
Pricing. "Price Structure" stays the module's code name (`price-structure/`,
`ps_*`, `price_structure.*` permission keys) and its URLs (`/price-structure/…`,
so links and comment anchors keep resolving). The Overview's per-offer table
is still titled "Price structure": that names the table's content, not the
module.

## Invariants

- **The engine is pure and is the contract.** `price-structure/engine/*` has
  no I/O, no React, no globals; the same functions run on the server and in
  the browser. The brief's §5 formulas and §11 acceptance numbers are its
  tests (`acceptance.test.ts`); a number the UI shows comes from the engine,
  never from arithmetic in a component.
- **Every blended figure is a weighted sum via component totals**
  (`blend()`): ROAS = Σ gross ÷ Σ spend, CML % = Σ CML ÷ Σ net revenue — never
  an average of per-offer ratios. Shares are normalised when used
  (`planLines`), so a plan whose shares don't add up still blends to 100%.
- **Units are fixed.** Percentages are stored as fractions (0.15), money is
  SAR unless the field ends in `Usd`, ad spend is per PLACED order and
  everything else per DELIVERED order. Full precision in storage and
  calculation; rounding only in `price-structure/format.ts`.
- **x ÷ 0 is never NaN**: 0 → 0, positive → +∞, negative → −∞ (`safeDiv`),
  and an infinite value shows as "—". A status against a target treats +∞ as
  B when higher is better and as Miss otherwise.
- **"ROAS for A / B" has ONE source**: `resolveRoasTarget` (eligible = enabled
  targets on CML %, CML per order or CML per unit; the chosen `roasTargetId`,
  else the first CML % target, else the first eligible). There is no
  break-even ROAS anywhere in the module, and no OPEX.
- **A version is one jsonb document** (`ps_versions.data`), validated by
  `price-structure/schema.ts` on every write AND every read; a stored row the
  schema rejects is skipped with a log line, never handed to the engine.
  Versions belong to the brand (`account_id` on every read and write).
- **Saves carry the revision they were based on.** `UPDATE … WHERE revision =
  $n` is the only write path for a document; a refused save is merged
  three-way by section (`components/price-structure/merge.ts`) and only an
  edit the server ALSO changed takes the server copy — never silently.
  Creating, importing and deleting a version are audited; an autosave is
  audited as `price_structure.version_edit` ONE line per person per SECTION
  per sitting (2026-11-07, `price-structure/edit-sections.ts`: name · notes ·
  settings · products · targets · plans · actuals; a sitting is 30 minutes) —
  a save that changes only sections this person's sitting already names
  writes nothing, so the history reads "edited products, targets", never a
  line per keystroke.
- **A version is a comment + Activity ENTITY (2026-11-07, user decision)** —
  anchor type `ps_version`, on EVERY page of the module (Overview, Plan,
  Products, Targets; not the Versions list), registered by the
  `VersionProvider` for the open `?v=`, so switching version switches the
  thread and the history; a copied version starts with an empty thread. Its
  thread and Activity are the module's members' only (any of the three
  grants, `viewAnchorRefused`), and mentioning someone without a grant is
  refused out loud. Comments, the rail and Activity are HOST infrastructure,
  like auth and the design system.
- **The open version is this tab's `?v=`.** A bare URL opens the user's last
  version for the brand (`ps_user_state`), then the most recently opened one;
  a brand with none gets a Blank "Main" (user decision, 2026-11-05 — the
  brief's sample data stays a "Start from" choice). Sidebar links inside the
  module carry `?v=` like Budget's `?month=` (`CARRIED_PARAMS`).
- **The module imports nothing from other modules' code or tables**; from the
  host it uses auth/permissions, tenancy, the design system, `lib/format`,
  the shared `readSheetRows` action, the CSV download helper, and the
  comments/Activity infrastructure (`CommentAnchor`, the audit).
- **Three grants, and the SERVER decides per action** (2026-11-06):
  `price_structure.view` opens every page read-only; `price_structure.edit`
  changes the open version's document; `price_structure.versions` creates,
  copies, imports, renames and deletes versions. Edit and versions each imply
  view (`lib/price-structure-access.ts`); none is in the editor preset. The
  layout and every page need any grant (a member with none sees
  `AccessRefused`, R-011 — tenancy-auth.md; the layout reads the versions
  INSIDE its Suspense so entering the module shows its own skeleton, not the
  Dashboard's, R-076); `saveVersion` compares the request
  with the live row and refuses a document change without `edit` or a
  name/notes change without `versions`; create / delete need `versions`;
  bootstrap, open and poll need any grant. The client only mirrors this — a
  viewer sees every field disabled (one `fieldset` per editing surface) and
  no add/delete affordance; the save status reads "Read-only".
- **CSV or Excel for actuals, one semantic layer**: `.csv` is split in the
  browser by `splitCsv` (`;` when it outnumbers `,`, quotes, BOM); a workbook
  goes through the house `readSheetRows`; both feed `parseActualRows`, which
  owns the header search, the forgiving numbers (Arabic-Indic digits,
  "$12,500", "12,5") and the warnings. The template is UTF-8 with BOM, CRLF.
- **Count metrics stay counts**: orders per month, orders in a period, units,
  days are integers at the field (`integer` NumberField) and in the schema.
- **A card's subtitle is ONE fact; a sentence is its ⓘ** (R-058, 2026-11):
  `SectionCard`'s `subtitle` says a unit or a scope ("SAR per delivered
  order", "{period}, whole period"); how to read the card is its `info` —
  an InfoTip beside the title — like every other page (ux-standards, Show,
  don't label). The module records no exception.

## History and rationale

- **2026-11-06 — access split in three** (user request after the first day in
  production: "more than one option"). The single `price_structure.access`
  became view · edit · versions, chosen over a two-way split and a per-page
  split because the team's real roles are "looks at it", "prices offers" and
  "keeps the versions tidy". The key `price_structure.access` is gone; any
  explicit grant of it falls out of `resolvePermissions` (unknown keys are
  filtered), so nobody silently keeps the old all-in-one right.
- **2026-11-05 — built from the team's brief** (`PRICE_STRUCTURE_MODULE_PROMPT.md`).
  Decisions taken with the user before building: a sidebar SECTION of four
  pages (the house pattern of Budget and Store) rather than in-page tabs;
  explicit grant of the one permission; the first version Blank; CSV and
  Excel uploads. Convention calls, reported in the build: the first nested
  layout in the app (`app/(dashboard)/price-structure/layout.tsx`) holds the
  client provider so edits and the autosave timer survive a page switch; the
  document is stored whole; realtime is the bell's polling pattern (10 s
  while visible + focus); view toggles live in `localStorage` in one file;
  the tab title is `Price structure · {Page} · {Version}` (R-100, 2026-11: a page with an eyebrow qualifies its tab title); two editable grids (sales mix,
  period orders) are hand-rolled editors (D22), every read-only table is a
  `DataTable`; `Switch` was added to `components/ui` and `UnitInput` /
  `useFieldFlow` were lifted out of the Budget module into `components/ui/
  unit-input.tsx` so the module could use the house money input without
  importing Budget.
