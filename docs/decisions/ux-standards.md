# UX standards

> **Read this file before building any user-facing surface**, and walk its
> checklist before reporting one. CLAUDE.md carries the sharpest lines; this is
> the full bar and where each line came from.
>
> **Scope: quality of the experience, NOT colour or theming.** Palette, tokens
> and the four themes are settled and live in `docs/decisions/ui-system.md`.
> Nothing here invites a visual redesign.

## Invariants

- **Consistency first — name the house pattern before you invent one.** Before
  adding UI, say which existing pattern handles this shape: `DataTable` for a
  flat table, `FilterShell` for a page's filters, `PageShell`/`PageHeader` for
  a route, `ChartShell` + `MetricPicker` + `SeriesLegend` for a chart, the
  house Dialog for a confirm, `sonner` toasts for a background result,
  `DownloadCsvButton` for an export. **If none fits, EXTEND one — don't fork
  it**, and say in the report which you extended and why the original couldn't
  serve. A second way to do the same thing is a bug with a long fuse: it looks
  fine on the day and disagrees with its twin a year later.
- **Every action gives feedback: pending, success, failure.** Nothing a user
  clicks may silently do nothing or silently fail. A route or search-param
  change goes through `useNavTransition` so the progress bar shows; a mutation
  reports its result (a toast for a row/background mutation, an inline banner
  for a form); a failure says what failed. **A failed submit keeps the user's
  input** — losing typed work to a network blink is worse than the blink.
- **Every state is designed, and you have seen each one.** Empty · loading
  (a tailored `loading.tsx` mirroring the real shape, never a generic box) ·
  error · exactly one item · many · overflow (long names, long lists, values
  that don't fit). A cell may not grow its row: cap, truncate with a `title`,
  and prove the cap bites at 375px.
- **No dead ends.** Every empty state says what to do next and offers the
  action that does it. Every error says what happened and what the user can do
  about it, in their words — "Excluded by rule «Spend below $1»" rather than a
  refusal with no exit. A disabled control explains itself.
- **Discoverability: a feature nobody can find does not exist.** Say where the
  user's eye lands and what tells them the capability is there. Affordances
  that only appear on hover must also be reachable by keyboard and visible
  where there is no hover. A control that is the ONLY route to an action may
  not be hideable — the records table's exclude column is `lockedVisible` for
  exactly this reason.
- **Copy says what things DO, in the product's voice.** Labels are the user's
  vocabulary, not the schema's: "Launch date", not `launch_date`; "Excluded by
  rule", not `excluded_source='rule'`. No developer nouns in the UI, no
  untranslated identifiers, no "Error: undefined". Numbers carry their unit and
  a dash means NULL — never a fabricated zero.
- **Economy: the frequent path is the shortest one, and friction scales with
  irreversibility.** A recoverable delete gets an UNDO toast, not a confirm; an
  unrecoverable one gets preview → acknowledge → type-to-confirm. Don't make
  somebody confirm something they can take back, and don't let them lose
  something they can't.
- **The phone is a first-class render, not a shrunk desktop.** Every surface
  works at 375px: no page-level horizontal scroll, touch targets reachable,
  toolbars that wrap rather than overflow, and sticky/pinned elements that
  still fit the frame. Check it on the surface itself, not in theory.
- **Show, don't label (2026-10-19, user rule).** A sign, a colour or a
  position that already says it makes the word noise. A pacing verdict is
  "−$1,844 (−61%)" in the behind colour, never "▼ behind $1,844 (−61%)"; a
  section's purpose is its title, not a sentence under it; a unit is printed
  once, and not where position already says it ("46.2%" on a card whose
  header is the total, not "46.2% of total"); a helper sentence that
  genuinely matters becomes an ⓘ tooltip — `InfoTip`, the house popover +
  title pattern, keyboard-reachable — rather than body copy. Accessibility
  keeps every word: `aria-label`, `title` or `sr-only` text still say
  "ahead", "behind", "projected". The test is one second: if the visual
  conveys it in under a second, the text is noise. It came from the Budget
  style pass — the Overview said "▼ behind" beside a minus sign in an amber
  verdict, and the Plan page explained each section in a sentence the eye
  had to read past to reach the numbers.
- **Walk the journey before you report it.** The composed-surface rig proves a
  unit; the WALK proves the path between units. Both are required, and the
  walk is where seam bugs live.

## History and rationale

*Where each line came from. Every one of these is a bug this system actually
shipped — the checklist is not a style opinion, it is a list of things that
went wrong and the shape of the mistake.*

### Consistency first

The 2026-07 consistency pass existed because every page had grown its own
table, its own filter bar, its own chart header. The fix was shared primitives
(`DataTable`, `FilterShell`, `ChartShell`, `PageShell`), and the rule that
keeps them shared is **extend, never fork**. Phase 3 of the columns work is the
rule paying off: five hand-rolled tables became consumers of one primitive, and
the sixth thing anybody needs now arrives free on all of them. When the
Top-creatives table needed a column that could not be hidden, the answer was a
new `DataColumn.lockedVisible` on the primitive — not a local workaround — and
it was used twice within a day.

### Every action gives feedback

App Router has no route-change events, and a same-route filter change navigates
inside `useTransition` — which keeps the current page on screen with no
spinner. It read as "nothing happened" on every slow query until
`NavProgressBar` + `useNavTransition` were introduced. Separately, the comment
composer did not clear itself after a successful post, so the sent text sat in
the box looking unsent — and the fix had to distinguish success (clear it) from
failure (keep every character), because losing a typed comment to a network
blink is the worse bug.

### Every state is designed

The Library's creative name carried `truncate` with **no width to truncate
against** for months: it looked capped and wasn't, and the overflow state had
simply never been looked at with a long name in it. The same class of miss hid
a pinned column 377px wide inside a 327px frame. Both were found by rendering
the state, not by reading the code.

### No dead ends

Manual un-exclude REFUSES a rule-excluded row — and says "Excluded by rule
«…»" with the place to go and change it, instead of failing silently or
succeeding wrongly. The Tracker's "behind" chip applies the off-pace filter AND
the counts deliberately ignore that filter, so the chip you clicked can take
you back out.

### Discoverability

The columns control moved into the table's own header row because a control in
a page toolbar is a control for the page, not the table — and the reason it
could move at all is that it is one button in a known corner on every table.
Row actions appear on hover but are always reachable by tab, and always visible
where there is no hover, because an affordance hidden from the keyboard is an
affordance hidden.

### Copy quality

The diagnosis report's instructions are string-pinned by tests because wording
that the model (or the user) reads is behaviour, not decoration. "Plan curve",
not "day weights"; "Excluded", not `excluded_from_aggregates`. The dash rule is
load-bearing: `—` means NULL and a real `0` renders as `0`, because a platform
that never measured a thing is not a platform that measured zero.

### Economy

Comment delete is an 8-second UNDO toast with no confirm, because it is
recoverable. Plan delete says "Recoverable — the previous plan stays in
Revisions" and skips type-to-confirm for the same reason. The cleanup tools,
which hard-delete rows nothing can restore, require preview → acknowledge →
type DELETE. The friction is proportional to the consequence, deliberately.

### The phone is a first-class render

375px has been a stated requirement since the consistency pass, and the
failures that still got through were always "I checked the component, not the
page": a toolbar built as a three-column grid that could not wrap, a sticky
column wider than the viewport. Both looked right on a desktop and were broken
on a phone, and both took one measurement to find.

### Walk the journey

Two bugs motivated this rule, and neither was findable in the unit that
contained it. Reaction pills shipped wedged between a message and its own Reply
button — the rig had shown the pills alone. The comment drawer's `highlightId`
outlived its post and then its page, so the thread scrolled to someone else's
comment and then to nothing. Both lived in the SEAM between parts that were
each individually verified. The composed surface catches a unit's siblings; the
walk catches what happens when the user moves between units.
