# Shared UI Refactor — Status & Handoff

**As of:** 2026-09-08 · **Branch:** `main` (uncommitted, 75 files changed) · **Nothing committed.**

This document exists because the work spans more than one session. It records what changed, what is
**verified in a browser**, what is **not**, and the exact traps that already bit once — so the next
session does not rediscover them the hard way.

---

## 1. What this refactor did

Introduced `@omniremit/ui` (`Frontend/packages/ui`), a pnpm workspace package consumed as
`workspace:*` by host, `lead_mf` and `customer360_mf`, and migrated all three apps onto it.

**Deliberately NOT via Module Federation `exposes`.** The host keeps declaring zero build-time
remotes; remotes stay independently buildable and deployable. `@omniremit/ui` is also NOT an MF
shared singleton — it holds no cross-instance state and `loadShare` carries real bundle cost.

### Shared components — 17 at the start of the refactor, 20+ now
Original set: `Button` (+`onHeader` variant), `Badge`, `Input`, `Checkbox`, `Switch`, `Tabs`
(+`variant="pill"`), `Icon` (57 inline SVGs), `DataTable` (+`bare`, `Empty`), `Pagination`,
`EmptyState`, `PageHeader`, `Drawer` (+`tone="danger"`), `Modal`, `Skeleton`×4, `classNames`,
`formatDate`/`formatDateTime`/`formatTime`/`formatRelativeTime`.

Added by later passes (each has its own section below): `ActorCell` §4e · `ColumnFilter` §4c ·
`SearchField` §4d · `FilterBar` §4j · `RowAction` §4c · `RowsPerPage` §4k · `NavItem` §4c ·
`Select` §4g · `ResponsiveRows` §4n · `Card` §4p · `DetailPanel` §4z.

**Hooks** (`packages/ui/src/hooks/`): `useDebouncedValue`, `useSuggestions`, `useCommittedFilter` —
the last two are §4ab and are what every search box on the platform now runs on. Read §4ab before
touching any filter: the query/applied split there is load-bearing, not stylistic.

### Application-level shared (deliberately not global)
- `lead_mf/src/shared/` — `LeadDiffTable`, `leadPage`, `drawerLayout`, `formField`, `dashboardCard`
- `customer360_mf/src/shared/` — `c360Common`

Each is used 2+ times inside one app only. Promote to `@omniremit/ui` only when a second app needs it.

### Inconsistencies eliminated
- **Seven** different table header treatments → one `DataTable`
- Page banner hand-rolled in **6** places → one `PageHeader` (theme.css already had
  `--omni-gradient-page-header` / `--omni-shadow-page-header` waiting, unused)
- Drawer shell built **7** times → one `Drawer`
- 26 ad-hoc button classes, 32 ad-hoc badge classes → shared `Button` / `Badge`
- 23 JS-driven hovers (`element.style` mutation) → real CSS `:hover` — **now 0**
- 3 stylesheets injected via `<style>` tags → real CSS rules
- 13 duplicate Google Fonts `@import` → one `<link>` in `host/index.html`
- Dead `host/src/shared/components/Table` deleted (zero imports, and it didn't match the real host table)

### Metrics
| | Before | Now |
|---|---:|---:|
| Raw inline styles (all 3 apps) | 1,029 | **0** |
| Permitted custom-property hand-offs | — | 25 |
| JS style mutations | 23 | **0** |
| CSS Modules | host 50 / lead 0 / c360 0 | host 50 / lead 32 / c360 11 |
| `lead_mf/index.css` | 2,925 | 2,031 |
| `customer360_mf/index.css` | 2,028 | ~1,990 |

---

## 2. ⚠️ Traps that already caused breakage — read before touching CSS

### 2.1 Remotes MUST import `@omniremit/ui/tokens.css`
Shared components use bare `var(--omni-*)` with **no fallback**. Without this import a remote running
standalone (`vite preview`, Vercel preview) has **no tokens at all** and renders with no background,
padding or radius — it looks completely unstyled.

Already wired in both remotes' `App.tsx`, **before** `./index.css`. Do not remove or reorder.

### 2.2 PostCSS `ignoreFiles` must contain BOTH patterns
`apps/{lead_mf,customer360_mf}/postcss.config.cjs`:
```js
ignoreFiles: [/\.module\.css$/, /tokens\.css$/],
```
- **`.module.css`** — Vite runs PostCSS *before* the CSS Modules transform, so an injected
  `#lead-mf-scope` gets hashed and the rule ships as `#_lead-mf-scope_zeozl_1 ._container_...`,
  which can never match the real element. Styles present in the bundle, silently never applied.
- **`tokens.css`** — must land on the real `:root`. Anything PORTALLED to `document.body`
  (`LeadFilterPopover`, `TimeRangeFilterDropdown`, both sidebar sub-navs) renders *outside* the
  scope; with tokens scoped, those subtrees had no background, border or radius at all.

### 2.3 Prefixer must not double-prefix
Both configs now guard with `if (selector.includes(prefix)) return selector;`.
A rule written as `#customer360-mf-scope { ... }` directly in a non-module stylesheet otherwise
becomes `#SCOPE #SCOPE { ... }` — needs a nested scope element, never matches. This had silently
killed customer360's `font-family`, rendering the entire remote in the browser's default **serif**.
(Pre-existing bug, not introduced by this refactor.)

### 2.4 Typecheck and build DO NOT catch any of the above
All three failures above shipped with **4/4 typecheck and 3/3 builds green**. Neither tool resolves
CSS custom properties. **Visual verification is mandatory.**

### Regression guards — run these after any CSS change
```bash
# must print 0
grep -rn "style={{" Frontend/apps/*/src --include=*.tsx | grep -v "'--" | wc -l

# must print only the literal id, no hashes, no double-prefix
grep -ohE "#[_a-zA-Z0-9-]*-mf-scope[_a-zA-Z0-9]*" Frontend/apps/lead_mf/dist/assets/*.css | sort -u
grep -c "mf-scope #.*mf-scope" Frontend/apps/customer360_mf/dist/assets/*.css   # must be 0
```

---

## 3. Verification status

### ✅ Verified in a real browser
| Screen | Result |
|---|---|
| Host login page | correct |
| lead_mf dashboard (standalone :5002) | banner, KPI accent bars, card frames, Inter |
| lead_mf View Leads | `PageHeader`, toolbar, `EmptyState` |
| lead_mf filter popover (portalled) | card, border, shadow, active tab, footer |
| customer360 search (standalone :5003) | banner, cards, correct font |

### ✅ Verified inside the host shell (2026-09-02, signed in, live data)
| Screen | Result |
|---|---|
| Host **Dashboard** | stat cards + accent bars, donut legend swatch (custom-property) |
| Host **Audit Logs** | `PageHeader` + Live Stream pill + date-range actions, `DataTable` with real rows. **This is the file repaired after the over-merge — date pills correct.** |
| Host **Approval Center** | `PageHeader` + `DataTable`; now structurally identical to Audit Logs. 246→64 hex tokenization shifted no colour. |
| Host **My Requests** | blue banner (was a plain white bar), `onHeader` Refresh |
| **Settings drawer** + `UserFormLayer` | gradient header, tabs, user card, 3-step indicator, section cards, Switch, footer — the riskiest file, correct |
| **lead_mf embedded** | sub-nav injected into host sidebar with count badge; `PageHeader`, KPI accent bars, chart legends, progress bars, `DataTable` with 8 real rows and per-row avatar colours |
| **customer360 embedded** | sub-nav injected, banner, search card, empty state, Inter font (serif bug fixed) |

Checked and dismissed: apparent right-edge clipping in screenshots is the browser at 125% zoom on a
1254px viewport — `scrollWidth === clientWidth`, no horizontal overflow.

**The visual verification is complete.** What remains below is code-quality polish, not correctness.

### Previously outstanding (now done)
Everything **inside the host shell**, which is where most host-side changes live:
1. Host **Dashboard** (donut legend swatch, stat tiles → custom-property hand-offs)
2. Host **Audit Logs** — migrated to `PageHeader` + `DataTable`
3. Host **Approval Center** — `PageHeader` + `DataTable`, 246→64 hardcoded hex tokenized
4. Host **My Requests** — `PageHeader` + `DataTable`; header changed from plain white bar to blue banner
5. Host **Settings drawer** — `UserFormLayer` (29 blocks), `RoleFormLayer` (19),
   `ApplicationFormLayer` (14), `SettingsCheckerAssignmentTab`, `SettingsUsersTab`,
   `SettingsApplicationsTab` — heavily converted, **highest risk**
6. **lead_mf embedded in the host** — all 5 migrated drawers, 6 migrated tables
7. **customer360 embedded in the host**

**Highest-risk area:** `AuditLogsPage.tsx` was corrupted once by an over-merging `className` fixer
script (it collapsed a nested `<span>`/`<button>`'s classes into the `PageHeader`). It was repaired
and the repo audited for the same signature with no other instances found — but that file deserves a
close look.

### How to verify (next session)
Prereqs: local SQL Server reachable on `localhost` with the four `OmniConnect_*` databases created
(see [SETUP.md](../SETUP.md) step 3), then all four services on 5155 / 5200 / 5046 / 5059 return
`/health` 200.

The Browser pane is a **separate browser with its own cookie jar** — a sign-in in the user's own
browser does not carry over. The user must sign in *in the pane*; the assistant must not type
credentials.

---

## 4. Also changed (backend, unrelated to CSS)

`AuthService`, `Customer360Service` `Program.cs` — startup migration/seed is now
wrapped in try/catch and logged, matching what `LeadService` already did. Previously an unreachable
database (Azure firewall 40615, serverless auto-pause 40613) let the exception escape `Main` and
killed the process, contradicting the stated design that each service boots and serves `/health`
even when the DB is unusable. Observed live: during an outage LeadService was the only survivor.

Builds clean: 0 errors, 0 warnings.

---

## 4b. Atomic-component migration — done for both remotes (browser-verified)

Measured and verified in the browser 2026-09-02. The earlier state of this section recorded that only
the STRUCTURAL components had been adopted and every atom (button, badge, banner) was still a local
copy. That is now fixed for both remotes.

### Shared-component adoption
| | host | lead_mf | customer360_mf |
|---|---:|---:|---:|
| `Badge` | 18 | 9 | 5 (+11 via `StatusBadge`) |
| `Button` | 26 | 21 | 21 |
| `DataTable` | 3 | 6 | 4 |
| `PageHeader` | 3 | 5 | 6 |
| `Drawer` | 0 (owns `SettingsDrawer`, the reference) | 5 | 0 |
| `EmptyState` | 0 | 3 | 0 |
| `Modal` / `Pagination` / `Input` | 8 / 3 / 6 | 0 | 0 |

### Local rules deleted, not merely shadowed
| | class rules | btn | badge | status | hero | title |
|---|---:|---:|---:|---:|---:|---:|
| lead_mf | 209 → **190** | 21 → 9 | 9 → 2 | 1 → 0 | — | — |
| customer360_mf | 209 → **179** | 28 → 13 | 13 → 7 | 5 → 0 | 5 → 0 | 12 → 10 |

### Two genuine bugs this surfaced

**1. lead_mf's reset was flattening every shared component.** `index.css` had a plain `* { margin:0;
padding:0 }`, which `postcss-prefix-selector` rewrote to `#lead-mf-scope *` — specificity 1-0-0 on
the id, beating EVERY single-class rule in the remote, `@omniremit/ui` included. PageHeader's
28/32px padding, Button's `0 18px`, Badge's `2px 12px` and DataTable's cell padding were all being
zeroed, which is why lead_mf's banner sat flush against the card edge while the identical component
rendered correctly in the host and in customer360_mf (whose reset sets only `box-sizing`). Fixed by
writing the reset as `:where(#lead-mf-scope) *` — `:where()` contributes zero specificity, so the
reset still applies where nothing else does and now loses every tie to a component stylesheet.
This is why "adopt the shared component" alone was not enough to make the apps match.

**2. `getStatusBadge` existed twice in lead_mf and the copies disagreed.** RecentLeadsCard and
LeadDetailsDrawer each had their own; a Rejected lead rendered red on the dashboard and pink in the
drawer, and the dashboard had no "Contacted" case at all, so a contacted lead reported itself as
"New" there. One `LeadStatusBadge` in `lead_mf/src/shared/` now serves both.

### App-level shared additions (repeated within one remote, so NOT global)
- `customer360_mf/src/shared/StatusBadge.tsx` — replaced 11 hand-written copies of the same
  `status-badge ${x.includes('active') ? ... : ...}` ternary. One of them (`.statusChip`) rendered
  pending statuses **pink**, a fourth status palette inside a single app.
- `customer360_mf/src/shared/formatValue.ts` — `formatValue` was byte-identical in FOUR components
  and `formatCurrency` in two, all declared inside the component body so they reallocated every
  render. Now uses `EMPTY_VALUE` (em dash) from `@omniremit/ui`; c360 previously showed an ASCII
  hyphen where the host showed an em dash.
- `lead_mf/src/shared/LeadStatusBadge.tsx` — see bug 2 above.

### Verified computed values (both remotes, live in the browser)
Identical, because they resolve to the same module hash from the same package file:
`header padding 20px 22px` · `h1 24px/800 Inter` (c360's own banner had been 21px/700) ·
`button padding 0 18px, radius 12px` · `PageHeader ._header_1vqrw_18` · `Button ._button_fx0qk_1`.

### Also fixed: standalone remotes rendered on a black page
`postcss-prefix-selector` rewrites a remote's `html, body { ... }` to `#<app>-mf-scope { ... }`, so
the real `<body>` had no background; on a dark-mode machine the browser painted it black behind the
white cards. `tokens.css` (which is in the prefixer's `ignoreFiles`) now carries a layered `body`
rule. Inert inside the host, where the host's unlayered rule wins.

## 4c. Cross-app consistency pass (2026-09-02, later)

Four issues raised after the atomic migration, plus one regression that pass had introduced.

### REGRESSION I introduced and have now fixed
Converting customer360's five banners to `PageHeader`, I passed each page's `styles.anchored` through
as `className`. `.anchored` is not a layout class — it is one of the two **decorative bloom circles**
that used to sit inside the banner:

```css
.anchored { position: absolute; top: -50px; right: -50px; width: 220px; height: 220px; border-radius: 50%; }
```

So every converted banner became a 220px absolutely-positioned circle floating off the top-right
corner, with its white title text invisible against the white page. Field Settings, Audit Logs, All
Products and All Interactions were all affected. `PageHeader` owns its own blooms, so the classNames
are simply gone and the four `.anchored`/`.anchored2` rule pairs are deleted.

**Why I missed it:** I verified the banner on one page (Individual Search, which passed a harmless
`.spacer7`) and generalised. Verify each converted call site, not one of them.

### 1. "Inspect" vs "View" — one verb now
The host says **View**; lead_mf's audit log said "Inspect" and customer360 said "Inspect" three times
and "Details" once. New shared `RowAction` defaults `children` to `"View"`, so reintroducing the
drift takes deliberate effort. Adopted 3× host, 1× lead_mf, 3× customer360; the host's two
`.viewDetailBtn` copies and the remotes' `.inspectBtn` copies are deleted. The remotes' tinted
"Inspect" also rested on a primary-ish background where the host's is a quiet neutral — so the same
control read as a primary action in a remote and a secondary one in the host.

### 2. Per-column filters in the remotes
New shared `ColumnFilter` renders the `<th>` itself, with an options list or a `freeText` mode, and
adds click-outside **and Escape** dismissal (none of the host's copies handled Escape). CSS copied
verbatim from the host's ApprovalCenterPage.
- **lead_mf Lead Directory — 5 columns** (Customer Details, IC Number, Contact as free text;
  Product, Branch as option lists). Backed by a new `setColumnFilter(field, value)` store action
  that writes into the *same* `filterRules` the toolbar popover edits, so the two stay in sync and
  a column filter counts toward "Filters (n)".
- **customer360 Audit Logs — 1 column** (Action). Its toolbar `<select>` is gone; the host puts this
  control in the header.
- **Not done:** an Actor filter on customer360's audit table. `GET /v1/audit` accepts `search` and
  `action` only, so the control would have had nothing to send. Needs an `actor` query parameter on
  Customer360Service first. A `<th>` comment records this.
- **Not done:** migrating the host's own 19 column filters onto the shared component. They work, they
  are the reference, each has bespoke option/date logic, and I could not visually verify the host at
  the time. Pure dedup, no user-visible change — worth doing, but not blind.

### 3. Sidebar rows
Both remotes portal their sub-navigation **into the host's sidebar**, so their rows sit directly under
the host's — which is what made the drift visible:

| | host `.navItem` | remote `.navBtn` |
|---|---|---|
| padding | 8px 10px | 7px 10px |
| gap | 9px | `--omni-space-2` (8px) |
| font-size | 13.5px | `--omni-font-size-sm` |
| radius | 8px | `--omni-radius-md` |

New shared `NavItem` (+ exported `navItemStyles`, the `pageHeaderStyles` pattern). The remotes render
`<NavItem>`; the host keeps its `NavLink` markup — the chevron/portal coordination documented in
`Sidebar.tsx` depends on it — but takes its classes from the shared module. Verified in the built
CSS: both remotes emit the identical `_navItem_1d799`, and the host emits
`omni-host-NavItem-module__navItem__088Mp` from the same source rules (each app bundles its own copy;
the declarations are what matter).

### 4. customer360 Field Settings and Audit Logs
**Field Settings** — four separate defects:
- The banner was the bloom-circle regression above.
- The profile-type toggle rendered **both** segments with `.saveBtn`, a solid primary fill, so the
  grey track behind them never showed and there was no way to tell which type was selected. Now a
  real segmented control with `aria-pressed`.
- The section wrapper carried `c360-table-container` — a **second** card frame around `DataTable`,
  which brings its own — and that outer frame's `overflow: hidden` clipped `DataTable`'s scroller, so
  the Masking Rule and Visible Chars columns could not be reached at all. Measured before:
  container 727px, table 888px, `overflow-x: hidden`. Now `DataTable minWidth={880}` inside a plain
  titled `<section>`, and it scrolls.
- `.strong` — a *section-title* style — was applied to the container while the actual title `<div>`
  had no class at all.

**Audit Logs** — the Actor column rendered `{log.user}` as bare text. Values are frequently raw ids
("User 60892301-eded-47ce-be0b-09a5823bc2bc"), which wrapped over five lines and forced **every row
to 124px tall**. New shared `ActorCell` (avatar tile + single truncated line, full value in `title`),
adopted by host, lead_mf and customer360 — lead and host each had their own `.actorCell` copy.

### Also fixed
`PageHeader`'s title block now takes `flex: 1 1 auto; min-width: 0`, so a long subtitle re-wraps and
the actions stay pinned right instead of the header wrapping them onto their own line early.

### Correction to an earlier claim in this document
I previously reported **0 inline styles** across all three apps. That was measured with a pattern
matching only the `style={{ … }}` literal form. Counting conditional and variable forms too, there
are **12** genuine violations (excluding the permitted custom-property hand-offs):
host 4, lead_mf 3, customer360 5 — e.g.
`style={disabled ? { cursor: 'not-allowed', opacity: 0.6, … } : undefined}` in lead's DatePicker and
`style={isLink ? { color: '#004EEB', … } : undefined}` in c360's DynamicProfileSection.
One of them (FieldSettings' `opacity: 0.5`) is fixed; **11 remain**.

### Verification status — read this before trusting the above
- **Visually verified in the host browser:** the bloom-circle regression and its fix; Field Settings'
  segmented toggle, section titles and table scroll; the c360 banners.
- **Verified by measurement, not by eye:** `DataTable` scroll (727 → 884 scrollable), shared class
  hashes in the built CSS, adoption counts, 4/4 typecheck, 3/3 build.
- **NOT yet seen rendered:** the sidebar `NavItem` change, `RowAction` in any app, `ActorCell` in the
  audit tables, and every `ColumnFilter`. The browser window was minimised for the second half of
  this work. These compile and ship, but "it builds" is exactly the evidence that proved worthless
  earlier in this refactor. **Look at them before trusting them.**

## 4d. Bug-fix pass from screenshot review (2026-09-02, third)

### THE ROOT CAUSE behind several of these
`postcss-prefix-selector` emitted `#lead-mf-scope .form-input`, which scores **1-1-0 on the id** and
therefore outranked EVERY CSS-module class in the app (0-1-0). There are ~94 call sites in the two
remotes that pair a global class with a module class expecting the module to refine it:

```jsx
className={`form-input ${shell.searchInput}`}   // .searchInput sets padding-left: 38px
```

`.form-input`'s `padding: 0 14px` won, so the search icon rendered **on top of the placeholder** in
the Lead Directory and the Customer 360 audit search. Fixed by emitting `:where(#scope) .foo` —
`:where()` adds no specificity, so a scoped global keeps exactly the weight it was authored with and
containment is unchanged. Same technique as the reset fix in §4b.

Note the prefix change alone is not sufficient where a global and a module class both target the
same property: they now TIE at 0-1-0 and source order decides, and `index.css` is bundled *after*
the module CSS. Where the module must win, the fix is to stop pairing them (below).

### Fixed
1. **Search fields** — new shared `SearchField` owns wrapper + icon + input + clear button, so no
   global class can fight it. Adopted in the Lead Directory, lead's Audit Logs and c360's Audit
   Logs. Verified: `padding-left: 38px`, class `_input_… _md_…`, no `form-input`.
2. **Create Lead "two input boxes"** — `.dropdown-trigger` paints the field's border/background and
   the `form-input` inside painted its own, so a bordered box rendered inside a bordered box.
   `.input` already declared `border: none; background: transparent`; it was losing. Dropped the
   global class from that input.
3. **Filter popover closed then instantly reopened** — the outside-click handler ran on `mousedown`
   and only excluded the popover, not the anchor. Pressing the trigger while open fired
   `onClose()` (state → false), then the trigger's `click` toggled it back to true. Now excludes the
   anchor; Escape also closes it (nothing handled the keyboard before).
   Verified in-browser: `closedOnTriggerClick: true`.
4. **`ColumnFilter` popover was clipped** — as an absolutely-positioned child of the `<th>` it was
   cut off by `DataTable`'s own `overflow-x: auto`; a scroll container establishes a clipping box no
   z-index escapes. Now portalled to `<body>` and positioned from the trigger's viewport rect. Safe
   outside the remote's scope specifically because it is a CSS Module (excluded from the prefixer,
   uniquely hashed) and the tokens live on the real `:root`.
5. **No way to remove ONE filter** — the popover's only escape was Reset, which cleared everything.
   Added an "Active" bar of per-criterion chips, each with its own ✕. Verified: chip renders
   `Product Home Financing ✕`, trigger reads `Filters (1)`.
6. **c360 audit showed a raw actor GUID** — BACKEND bug. `AuditController.GetAuthenticatedUser()`
   read `ClaimTypes.Name` (the long WS-Security URI) while `Program.cs` sets
   `MapInboundClaims = false`, which preserves the SHORT claim names. The name claim never matched,
   so every row fell through to the subject id and rendered
   `User 60892301-eded-47ce-be0b-09a5823bc2bc`. Now reads `JwtClaimTypes.Name` / `.Email` /
   `.Subject`. **Customer360Service must be restarted for this to take effect.**
7. **Every c360 audit row showed the same status** — the row used the component-level `isSuccess`,
   which is derived from `selectedLog` (the drawer's record). Now computed per row.
8. **c360 customer reference rendered `-` above the id** — when there is no customer name the
   identifier *is* the reference, so it becomes the primary line; a genuinely empty cell uses
   `EMPTY_VALUE`.
9. **Action/status pills** in c360 audit were four hardcoded `{bg,text,border,dot}` palettes fed
   through inline custom properties — now shared `Badge` tones.
10. **Lead audit table ran flush to the card edge** — card gains horizontal inset and the tables
    inside use `DataTable bare`, since the card already IS the frame (it was drawing two).
11. **Lead detail drawer truncated names** — `.lead-kpi-value` had `white-space: nowrap`, cutting
    "Johor Bahru Main Hub" and "Azman bin Ibrahim". Now clamps to two lines; cards top-align so the
    icon tile sits against its label rather than floating mid-block.

### Column filters added
| | columns | how |
|---|---|---|
| lead_mf Lead Directory | 5 | Customer Details, IC, Contact (free text); Product, Branch (lists) |
| lead_mf Audit Logs | 3 | Action (was a toolbar `<select>`); Actor, Status (client-side) |
| c360 Audit Logs | 2 | Action (was a toolbar `<select>`); Status (client-side) |

Free-text columns submit on Enter/blur rather than per keystroke. Client-side filters narrow the
fetched page and are commented as such, so nobody assumes they paginate.

### Still open
- **Actor filter on c360 audit** — `GET /v1/audit` accepts `search` and `action` only. Needs an
  `actor` query parameter before the control can exist; a `<th>` comment records this.
- **Host's 19 column filters** not migrated onto shared `ColumnFilter` (works today; pure dedup).
- **11 inline styles** remain (host 4, lead 3, c360 4).
- **89 global+module className pairings** remain across the remotes. They no longer lose to an id,
  but they tie, and index.css is bundled last — so any that need the module to win must stop pairing.

### Verified in-browser this pass
Search field padding · filter popover position · close-on-trigger · active chips · Field Settings
segmented toggle and table scroll. **Not seen rendered:** the column filters with real data, the
c360 actor-name fix (needs the backend restart), and the lead detail drawer.

## 4e. Screenshot review, pass two (2026-09-02, fourth)

### A recurring bug class worth naming
Three separate defects this session had the SAME cause: an earlier automated class-renaming pass
put a class on the wrong element, or left an element with no class at all. Each one looked like a
CSS problem and was actually a misplaced label:

| symptom | actual cause |
|---|---|
| five banners rendered as floating circles (§4d) | `.anchored` — a decorative bloom — passed as `PageHeader`'s `className` |
| Field Settings' section title unstyled, container over-padded (§4b) | `.strong` — a *title* rule — applied to the container |
| c360 toolbars squeezed to 370px, Refresh wrapped below | `.spread` — a *toolbar* rule — applied to the card CONTAINER, making the card a flex ROW so the toolbar and the table sat side by side |
| c360 toolbars had no layout at all | the toolbar `<div>` was left with an **empty className** on all three table pages |

Now zero elements across all three apps carry an empty className slot. Worth re-running that check
after any bulk edit:
```bash
python -c "import re,pathlib;print(sum(len(re.findall(r'<(div|span|button|section)\s*
\s*
\s*>',f.read_text(encoding='utf-8'))) for a in ['host','lead_mf','customer360_mf'] for f in pathlib.Path('Frontend/apps',a,'src').rglob('*.tsx')))"
```

### Fixed this pass
1. **c360 audit still showed the actor GUID.** The backend fix (§4d #6) only affects rows written
   from now on — every existing row literally contains `User 60892301-eded-…`. Added
   `customer360_mf/src/shared/resolveActor.ts`: resolves the id against the host bridge's
   `getCurrentUser()` when it is the signed-in user's own (the common case for reading your own
   trail), and otherwise returns `{name: null, id}` so the cell stops pretending an id is a name.
   `ActorCell` gained a `fallback` prop that renders the unresolved case in muted monospace rather
   than the bold treatment reserved for people. **Verified: the column and the drawer now read
   "Super Admin".**
   - Two spots in the drawer (`Triggered by …`, the actor card) were still reading the raw
     `selectedLog.user` rather than the resolved name; both now use it.
2. **Audit drawer footer was left-aligned** — `.audit-drawer-footer` used `justify-content:
   space-between` with a single child, which pins a lone child to the start. Now `flex-end`, and
   the close button is the shared `Button` (its hand-rolled `.audit-footer-close-btn` is deleted).
3. **c360 table cards laid out sideways** — see `.spread` above. `.c360-table-container` is now an
   explicit column and no longer `overflow: hidden`, which was latently clipping `DataTable`'s own
   horizontal scroller the same way Field Settings' wrapper did.
4. **Lead Directory was uniformly heavy.** The host's audit table gives emphasis to exactly ONE
   cell — the person the row is about, at 600 — and keeps everything else at 400-500. This table had
   the customer name at 600, product at 600, and phone AND branch at 500, so five of six columns
   competed. Phone and branch are now 400 (the counterpart of the host's description cell), product
   500, customer name stays 600, date matched to the host's `.timeCell` (12px/500).
5. **`+60 +60 19-456 7890`** — some records store the country code inside `phone` while the create
   flow also prepends `phoneCountryCode`. Added `formatPhone` to collapse the repeat; the doubled
   prefix had also been wrapping the column onto two lines and making every row taller.
6. **Created Date had no filter** — now a `freeText` `ColumnFilter` bound to the store's
   `createdFrom` criterion. Every column in the Lead Directory except Actions now filters (6).

### Verified in-browser this pass (host shell, signed in, live data)
- Sidebar: remote sub-items now measure identically to the host's own rows (shared `NavItem`).
- Lead Directory: 6 column-filter chevrons, search icon clear of the placeholder, phone on one
  line, balanced weights, table inset from the card edge.
- c360 Audit Logs: full-width toolbar with Refresh on the right, no horizontal scroll, actor
  "Super Admin", clean customer reference, Action + Status filters, `View` row action.
- c360 Audit drawer: resolved actor in both the timeline and the actor card, right-aligned footer.

### Still open
- **`resolveActor` only resolves the CURRENT user's id.** Rows written by other officers before the
  backend fix will show a shortened id, not a name — there is no endpoint to look up a user by id
  from this remote. New rows carry the real name once **Customer360Service is restarted**.
- Actor filter on c360 audit (needs an `actor` query param).
- Host's 19 column filters not migrated to shared `ColumnFilter`.
- 11 inline styles; ~89 global+module className pairings.

## 4f. Audit-table consistency pass (2026-09-02, fifth)

### A free-text column filter could not be closed from its own header
`ColumnFilter`'s free-text input closed the popover on blur. `mousedown` on the trigger blurs the
input FIRST, so pressing the chevron to dismiss it ran: blur -> `setOpen(false)`, then the trigger's
click -> `setOpen(o => !o)` with `o` already false -> **true**. It shut and reopened in one gesture.
Affected every free-text column: lead's Actor / Role, and View Lead's Customer Details, IC Number
and Contact.

Blur now COMMITS without closing; Enter commits and closes; outside-click closes. Same root cause as
the `LeadFilterPopover` bug in §4d #3 — a close-on-blur racing a toggle-on-click.
Verified in-browser: `openedOnFirstClick: true, closedOnSecondClick: true`.

### One timestamp format, everywhere
Three audit tables had three formats:

| | before |
|---|---|
| host | `Sep 2, 2026, 09:03 AM` |
| lead_mf | `Sep 02, 2026, 03:46:34 AM` (2-digit day + seconds) |
| customer360_mf | `Sep 2, 2026, 09:03:50 AM` (seconds) |

`formatAuditTimestamp` in `@omniremit/ui` is now the single source, matching the host byte for byte.
Seconds are deliberately dropped: an audit table is read by scanning a column of times, and the
extra field widens every row for precision nobody scans for. Both local formatters are deleted —
`grep "toLocaleString('en-US'" ` across the three audit pages returns **0**.

### One column order
The host's system-audit table reads TIME → SERVICE → **ACTOR → ACTION** → ENTITY. Both remotes had
ACTION before ACTOR. Reordered (headers *and* cells) so all three read the same way:

| | order |
|---|---|
| host | TIME · SERVICE · ACTOR · ACTION · ENTITY · details |
| lead_mf | TIMESTAMP · ACTOR / ROLE · ACTION · EVENT DESCRIPTION · STATUS & IP · details |
| customer360_mf | TIMESTAMP · ACTOR / OFFICER · ACTION · CUSTOMER REFERENCE · DESCRIPTION · STATUS · details |

### Filters filled in
| page | filters |
|---|---:|
| lead_mf View Leads | 6 |
| lead_mf Audit Logs | 3 |
| customer360 Audit Logs | 4 (added Actor, Customer Reference) |
| customer360 All Interactions | 3 (added Channel, Officer; Status moved out of the toolbar) |
| customer360 All Products | 2 (Category moved out of the toolbar, Status added) |

Both remaining toolbar `<select>`s are gone — every one of these controls now lives in its column
header, as the host does. `AllProducts` and `AllInteractions` also picked up the shared
`SearchField`, so their search icons no longer sit on the placeholder text.

**Deliberately NOT added:** a Branch filter on All Products. `CustomerProduct` has no branch field
and that column renders a literal `"-"` for every row — the control would have nothing to filter. A
`<th>` comment records it. (Same call as the c360 actor filter in §4d, which is now possible
client-side and *was* added.)

### Verified in-browser
Lead Audit Logs and c360 Audit Logs side by side: identical column order, identical timestamp
shape, filter chevrons present, free-text popovers open and close from their own header.

**Not seen with data:** All Products and All Interactions filters — both need a customer profile
loaded first. They typecheck and build.

## 4g. Field Settings, both apps (2026-09-02, sixth)

The same screen exists in lead_mf and customer360_mf and they rendered it two different ways, with
most controls being browser defaults rather than platform components.

### New shared primitive: `Select`
Both pages rendered a bare `<select>` for the masking rule, so it kept the browser's own border,
radius and arrow and read as an OS control dropped in beside fully-styled inputs. `Select` wraps a
NATIVE select — the options list stays the OS's, which keeps keyboard behaviour, mobile pickers and
screen-reader support for free — and styles only the closed control, with `appearance: none` and a
drawn chevron. Chrome copied from the host's `CheckerAssignmentFormLayer` `.select`. Three sizes.

### Migrated to shared components
| was | now |
|---|---|
| 4 raw `<input type="checkbox">` | `Checkbox` |
| 2 raw `<select>` | `Select size="sm"` |
| lead's hand-rolled product tab row | `Tabs` — gains `role="tablist"`, roving tabindex, Left/Right/Home/End |

`grep 'type="checkbox"'` and `grep '<select'` both return **0** on the two pages.

### Aligned between the two apps
- **Section headings** — both are now the uppercase 11px micro-heading the platform's table headers
  use, so a section label and the column labels beneath it belong to one system. lead's was 13px
  sentence-case; c360's was 13.5px.
- **Field inputs** — one chrome for label/order/visible-chars: 1.5px token border, 8px radius,
  32px tall, and a real focus ring. They previously had a 1px hairline and **no focus state at
  all**, on a page that is nothing but editable cells. c360's label input was also 290px wide
  against lead's 180px.
- **Visibility toggle** — a tinted tile (blue when visible, muted when not) rather than a bare
  glyph, matching the tone treatment used elsewhere.
- **Disabled states** — masking rule and visible-chars now grey out consistently when a field is
  not sensitive.

### Two more instances of the global-vs-module specificity tie (§4d)
- c360's label input paired `c360-input` with a module class; the global won, which is why it was
  290px.
- c360's profile-type row paired `c360-search-panel` (`flex-direction: column`) with a module class
  setting `row`; the global won, so the segmented control floated centred in a full-width card with
  dead space either side. Now its own `.profileBar`.

Both pages now carry **0** global+module className pairings.

### Verified in-browser
lead and c360 Field Settings side by side: same heading treatment, same input chrome and widths,
same checkbox and select, same visibility tile, toggle left-aligned.

## 4h. Phantom scroll below the UI (2026-09-02, seventh)

Every page scrolled well past the end of its content into blank space. **My regression**, introduced
in §4g when the two Field Settings pages adopted the shared `Checkbox`.

`Checkbox` hides its real `<input>` with `position: absolute` — the standard way to keep a control
focusable and in the accessibility tree while showing a styled box instead. But `.label`, its
parent, was never given `position: relative`, so each hidden input resolved against the **initial
containing block** rather than its own label. An absolutely positioned box still contributes to its
containing block's scrollable overflow, so on a page with one checkbox per field the document grew
far past the layout:

```
document.body.scrollHeight            639   ← the layout fits
document.documentElement.scrollHeight 1357  ← the whole difference was those inputs
```

Fixed by positioning `.label` and pinning the input to `top: 0; left: 0` with `margin: 0` and
`pointer-events: none`. `Input`, `SearchField` and `Select` already positioned their wrappers
correctly; `Switch` uses the same hidden-input trick and already had `position: relative` on
`.switch`. `Checkbox` was the only one missing it.

### Verified — overshoot is now 0 everywhere checked
`lead Field Settings` (was 718px of blank scroll) · `c360 Field Settings` · `c360 Individual` ·
`c360 Audit Logs` · `host Dashboard` · `Approval Center` · `My Requests`.

### Regression guard
`document.documentElement.scrollHeight - document.documentElement.clientHeight` should equal the
page's real content overflow. When the app's own layout fits the viewport but that number is large,
suspect an absolutely positioned descendant with no positioned ancestor — comparing it against
`document.body.scrollHeight` isolates it immediately.

## 4i. Pagination and table search (2026-09-02, eighth)

### Ten pagers became one
Every paginated table had its own implementation — the host's Audit Logs, Approval Center and My
Requests, both remotes' audit logs, the Lead Directory, and customer360's All Products and All
Interactions — and they disagreed on nearly everything:

| variant | seen in |
|---|---|
| `Showing 1 to 10 of 42 records` + per-page select + bare `‹ 1/5 ›` | Lead Directory |
| `Showing 8 of 42 products` + per-page select + bare chevrons | c360 list pages |
| `‹ Previous · Page 2 of 5 · Next ›`, centred, no summary | host ×3, c360 Audit |
| `Showing X to Y of Z` + `‹ 2 ›`, no page count | host Settings tabs (the old shared one) |

The shared `Pagination` now carries the union, so no caller rebuilds it:

```
Showing 1 to 10 of 42 leads          Per page [10 v]   ‹ Previous   Page 1 of 5   Next ›
```

- **Labelled arrows, not bare chevrons.** An icon-only control at the end of a long table gives no
  hint which way it moves; the host's Audit Logs — the reference — spells them out.
- **Summary left, controls right**, rather than the host's centred row: at 1300px a centred pager
  floats in the middle of the card with nothing either side, and the record count had nowhere to go.
- **Disabled buttons stay legible** (muted surface) rather than dropping to 0.5 opacity. At the ends
  of a list that is the normal state, and a control that looks broken there is worse than one that
  looks inert.
- **`onPageSizeChange` is optional** — omit it and the rows-per-page control is hidden, for tables
  whose page size the caller fixes (My Requests).
- **`hideWhenSinglePage`** (default on) keeps a pager from appearing under a three-row table, but
  never hides one that still offers a page-size control.

`grep` for the old local pager classes across all three apps now returns **nothing**. The dead
`.pagination` / `.pageBtn` / `.pageIndicator` rules are deleted from the host's three stylesheets.

lead_mf's audit table also gained a rows-per-page control it never had — its size was pinned at 10
with no way to change it, so `setAuditPageSize` was added to the store.

### Cross-column search on My Requests
It was the only table in the platform with **no search at all** — status filter and paging, nothing
else. Added a `SearchField` spanning every column the table renders (module, action, entity,
checker, rejection reason, status), narrowing the fetched page since the endpoint takes only status
and paging.

### Verified in-browser
Lead Directory pager: `Showing 1 to 8 of 8 leads | Per page 10 | Previous | Page 1 of 1 | Next`,
`justify-content: space-between`, 14px/20px padding, border-top, 34px buttons, both arrows correctly
disabled on a single page. My Requests: search present with `padding-left: 38px` (icon clear of the
placeholder) and the pager correctly hidden while empty.

### Pagination adoption
host 5 (Audit Logs, Approval Center, My Requests, 3 Settings tabs) · lead_mf 2 · customer360_mf 3.

## 4j. Filter chips, real actor lists, My Requests (2026-09-02, ninth)

### New shared component: `FilterBar`
The host's Audit Logs had the only active-filter chip bar in the platform. It is now shared and on
every filterable table (7 places). This matters beyond looks: once filtering moved into column
headers, an active filter became **invisible** unless you reopened the column that set it — a table
could be showing four rows out of four hundred with nothing on screen explaining why. The bar names
every filter, each chip removes just its own, and "Clear all" resets them together.

The host's own hand-rolled version is replaced by the shared one, so this is dedup, not a second
implementation.

### Actor filters now list the actors that are actually there
Actor / Officer / Channel / Customer columns were empty type-to-search boxes — you had to already
know a name to find a row. They now offer the distinct values present in the loaded rows, sorted,
with typing to narrow. Derived from the same scope the filter applies to, so the list can never
offer a value that returns nothing. Verified: lead's Actor column offers exactly
`All Actors · Admin User · System Administrator` — the two actors in the log, not the role table.

### A contradiction the testing exposed
With an actor filter on, lead's audit read **"Showing 11 to 13 of 13 events" above an empty table**,
and the banner said "3 Events Logged" while the pager said 13.

Cause: these filters run CLIENT-side (the endpoint takes `action` and `search` only) while paging
runs SERVER-side. Both cannot be authoritative — page 2 held three rows, all filtered out.

While a client-side filter is active the pager now describes the rows actually on screen and server
paging is suppressed. **Consequence worth knowing: a client-side filter only sees the loaded page,
so matches on other pages are not reached.** Fixing that properly needs `actor` / `status` query
parameters on both audit endpoints. Verified: filter on → 6 rows, no misleading pager; Clear all →
back to `Showing 1 to 10 of 13 events · Page 1 of 2` with Next enabled.

### My Requests brought up to its siblings
It was visibly thinner than Approval Center and Audit Logs. Added the four summary cards (Pending,
Approved, Rejected, Total Submitted) with the accent-bar treatment lifted from Approval Center, plus
the cross-column search and the shared `FilterBar` and `Pagination`.

**Trap when lifting rules between stylesheets:** the extractor pulled `.summaryGrid` and
`.summaryCard` overrides OUT of their `@media` blocks, so the responsive 2-column and 1-column steps
applied unconditionally and the grid rendered as a single stacked column at full width. Restored to
their breakpoints. Worth checking after any rule-copying script:
```bash
# indented rules sitting outside any @media block
python -c "..."   # see the check used in this pass
```

### Verified in-browser
Lead audit: actor list, chip bar `FILTERS: Actor: Admin User × … Clear all`, active-column dot,
Next paging 1→2 (`Showing 1 to 10` → `Showing 11 to 13`), Clear all restoring full paging.
My Requests: four summary cards in a proper 4-up grid with accent bars, search, pills, table.

## 4k. Rows control, plain-language headers, toolbar alignment (2026-09-02, tenth)

### Rows-per-page moved to the toolbar
New shared `RowsPerPage` — label "ROWS" plus a Select — copied from the host's Audit Logs
`.rowsDropdownWrap`, which is the reference for both the placement and the wording. It belongs at
the top with Refresh and Export: that is where you decide how much to see *before* reading, and it
had been in the pagination footer everywhere else, so changing it meant scrolling past the whole
table and back.

`onPageSizeChange` is now passed **nowhere** — every page-size control is in a toolbar. Caught while
migrating: the two host pages briefly had TWO of them, their own toolbar control plus the footer one
I had added in §4i.

### Plain-language column headers
22 replacements across all three apps. Only genuine jargon was touched — Module, Status, Product and
similar are left alone:

| was | now |
|---|---|
| Actor / Role · Actor / Officer · ACTOR / EMAIL | **Performed By** |
| ENTITY | **Record** |
| Timestamp | **Date & Time** |
| Event Description · Description | **What Happened** |
| Status & IP | **Result & IP Address** |
| SUBMITTED | **Date Submitted** |
| API Field | **System Name** |
| Display Label | **Label Shown to Users** |
| Masking Rule | **How It's Hidden** |
| Visible Chars | **Characters Shown** |
| RM Name / RM ID / RM Branch Code / RM Contact Number | **Relationship Manager / Manager ID / Branch Code / Manager Contact** |
| Account No | **Account Number** |
| Date Complaint | **Complaint Date** |

Filter popover titles, chip labels and placeholders were renamed to match, so "Performed By" is the
term everywhere rather than only in the header — `All Actors` became `Everyone`, `Filter Actor`
became `Filter Performed By`.

### Toolbar alignment
- **lead_mf's Refresh was an icon alone** on both tables, sitting beside labelled buttons — it read
  as an afterthought and left the row unbalanced. Now a labelled `Button` with the icon.
- **customer360's search had no max-width** and grew to the full card. Capped at 520px to match
  lead_mf's audit toolbar; a search box the width of a 1500px table reads as the page's main input
  rather than one control among several, and it pushed Rows and Refresh to the far edge.

Both audit tables now render an identical toolbar: search (520px) · ROWS · Refresh · Export.

### Pagination coverage
Every list table has a pager and a rows control: host ×3, lead_mf ×2, customer360_mf ×3.

**Four tables deliberately have neither**, and should not:
| table | why |
|---|---|
| `RecentLeadsCard` | a dashboard preview of the latest few leads, with "View All" beside it |
| `LeadDiffTable` | before/after for a single change, inside a drawer |
| `FieldSettingsPage` (lead) · `FieldSettings` (c360) | configuration forms, not lists. Every field in a section has to be visible to configure it, and paging a form behind a single "Save Changes" invites people to assume edits on page 1 were lost |

### Verified in-browser
lead Audit Logs and c360 Audit Logs side by side: identical toolbars (`ROWS [10]` · labelled
`Refresh`), identical headers (`DATE & TIME · PERFORMED BY · ACTION · … · DETAILS`), c360's search
now the same width as lead's.

## 4l. Custom row counts, remembered page size, My Requests filters (2026-09-02, eleventh)

### `RowsPerPage`: presets + Custom + memory
Options are now **5 / 10 / 15 / 20 / Custom**, matching the host's Audit Logs. Choosing Custom
reveals a number input beside the select rather than replacing it, so the presets stay one click
away; the entry is clamped to 1-500 and snaps back to the value in force if you leave it invalid.

**The choice is remembered.** Each table passes a `storageKey`, and the size is written to
`localStorage` under `omni.rowsPerPage.<key>` and read back as the initial state. Someone who works
at 50 rows had to reset every table on every visit — the size reverted to each page's own hardcoded
default every time.

Per table, not global: a comfortable size for an audit trail is not necessarily right for a
six-column directory.

| key | table |
|---|---|
| `host.audit` · `host.approvals` · `host.myRequests` | the three host tables |
| `lead.audit` · `lead.directory` | lead_mf |
| `c360.audit` · `c360.products` · `c360.interactions` | customer360_mf |

Reads and writes are wrapped in try/catch — `localStorage` throws outright in some privacy modes,
and a table failing to render because it could not remember a preference would be a poor trade.

The host's own two rows controls are replaced by the shared one, so its bespoke
`isCustomPageSize` / `customPageSizeInput` state and both handlers are deleted from
AuditLogsPage and ApprovalCenterPage. `RowsPerPage` is now the only implementation.

### My Requests: column filters, and the duplication removed
It filtered status **twice** — a pill strip (All / Pending / Approved / Rejected) above a table
that, once column filters arrived, would also carry a Status column. Approval Center and Audit Logs
both use column filters and no pills, so the pills are gone and the page has four:

| column | scope |
|---|---|
| Status | SERVER-side — the endpoint takes it |
| Module · Action · Checker | client-side, each offering the values actually present |

`.filterPills` / `.pill` / `.pillActive` deleted. The chips and Clear all cover all four plus the
search, so what is in force is visible in one place.

### Verified in-browser
Select offers `5, 10, 15, 20, Custom`. Choosing Custom reveals the input pre-filled with the current
size. Setting Approval Center to 15 wrote `omni.rowsPerPage.host.approvals = 15`; after a reload and
navigating back, it **opened at 15** while My Requests — a different key — correctly still opened at
10. My Requests renders banner, four summary cards, search + ROWS, and column-filter chevrons on
Module, Action, Checker and Status.

## 4m. Audit backlog — P0/P1 execution (2026-09-02, twelfth)

Executed against the audit in `~/.claude/plans/sorted-snacking-rain.md`.

### P0.1 — the host now uses the shared package
`apps/host/src/shared/components/` held its **own** `Badge, Button, Checkbox, Input, Modal,
Pagination, Skeleton, Switch, Tabs`, all of which also existed in `packages/ui`. Only **4** host
files imported the shared package, so `Button` ran as two implementations — host-local in 10 files,
shared in 17 across the remotes. No CSS work could have made the apps consistent while that held.

Verified compatible before touching anything: `Badge`/`Modal`/`Input` were **byte-identical**;
shared `Button` and `Pagination` are **strict supersets** (Button only adds `onHeader`). Nothing
existed solely in a host copy, so consolidation could not regress the host.

- 8 folders deleted, ~45 imports repointed across 13 files.
- **`Skeleton` was re-based, not deleted** — its 4 primitives now re-export from `@omniremit/ui`
  while the 8 **card-level** skeletons (`SkeletonUserCard`, `SkeletonDonutChart`…) stay local:
  each is shape-matched to a specific host card for zero layout shift, so they describe host
  layouts and are not shareable. Every existing `from '…/shared/components/Skeleton'` import keeps
  working.
- One import my pattern missed — `FederationErrorBoundary.tsx` used a relative sibling path
  (`'../Button/Button'`). Caught by the build, not by typecheck.

**Result: 4 → 18 host files on the shared package; 16 → 8 local folders**, and the 8 that remain
(`AppShellSkeleton, BrandMark, ErrorBoundary, Icon, PermissionGate, RouteFallback, Skeleton, Toast`)
are genuinely host-only.

### P1.4 — `DataTable` has a default overflow policy
A cell previously had **no cap at all** — no `max-width`, no `overflow`, no wrap rule — so the data
decided the column width and the row height. Truncation was opt-in per page, and most pages did not
opt in.

Now: `max-width: 280px` + `overflow: hidden` + `text-overflow: ellipsis` + `overflow-wrap: anywhere`,
with a 2-line clamp applied only to a cell's own text (`:where(span,div,p):only-child`) so cells
containing a `Badge`, an `ActorCell` or a button row lay out normally. Overridable per table via
`--omni-data-table-cell-max` / `--omni-data-table-cell-lines`.

Also capped: **`Badge`** (`max-width: 180px`) — `nowrap` with no cap meant one long status name set
the width of its whole column; and **`PageHeader .subtitle`** (2-line clamp) — `max-width` bounded
line length but not line *count*, so long subtitles stretched the blue banner.

### P1.5 — every table now engages its scroller
`.table`'s `min-width` defaults to 0, so a table without the `minWidth` prop never triggers the
horizontal scroller — it compresses and wraps instead. **6 of 12 tables** had none:

| table | cols | set to |
|---|---:|---:|
| c360 `AllProducts` · `AuditLogs` | 8 | 880 |
| c360 `AllInteractions` | 7 | 780 |
| lead `AuditLogsPage` | 6 | 720 |
| lead `RecentLeadsCard` | 6 | 680 |
| lead `LeadDiffTable` | 3 | 420 |

~110px per column, matching the host's existing 720/6 and 760/9.

### P0.3 — breakpoint tokens
`tokens.css` had 77 colour, 11 font, 8 spacing, 5 radius… and **zero** breakpoints, so 20+ ad-hoc
px values were scattered across the repo. Added `--omni-bp-lg/md/sm/xs` (1100 / 768 / 640 / 480).

**Documented caveat:** custom properties are **not valid inside `@media`**. These give JS
(`matchMedia`, the future priority-column logic) and human authors one vocabulary; stylesheets must
still write the literal and name it in a comment. Existing media queries are not yet migrated.

### P2.11 — one `getInitials`
Six implementations that **disagreed**. "Lee Sook Fern" initialised as **LS** in `RecentLeadsCard`
(first + second word) and **LF** in `LeadDetailsDrawer` (first + last) — same person, same app, two
avatars. Two host copies ignored name particles entirely, so "Nurul Aisyah binti Abdullah" came out
**NB** there and **NA** in the remotes; customer360 returned a hyphen where others returned "??"/"U".

One shared `getInitials(name, { email, fallback })`: drop particles (`bin`, `binti`, `a/l`, `a/p`,
`van`, `de`…), then first + last remaining word. First+last is what an avatar convention expects and
stays stable when a middle name is present in one data source and absent in another — which is
exactly the CRM/lead-store case. Optional `email` fallback covers the host's user lists.

**6 → 0 local definitions.**

### Verified
4/4 typecheck, 3/3 builds. In-browser: Approval Center and lead Audit Logs render correctly on the
shared components; measured on the live table — `td max-width 280px / overflow hidden / ellipsis`,
`Badge max-width 180px`, uniform row heights, `documentElement` overshoot **0**; c360 Audit Logs now
reports `min-width: 880px` with `overflow-x: auto`.

### Not done — carried to the next phase
- **P1.6 priority columns + row expander.** Blocked on a decision: `DataTable` takes `children`, so
  it does not know its columns. The agreed design needs a column-config API and a breaking change
  across all 12 tables. The ~140 lines of dead CSS at `AuditLogsPage.module.css:991–1130` are ready
  to reuse for it.
- P1.7 fixed-width popovers (520px `LeadFilterPopover` first) · P1.8 sidebar icon-rail and the
  remotes' `overflow-x` inconsistency.
- P0.2 host tokenisation (still ~10%) · P2.9 two icon systems · P2.10 shared `Card` ·
  P2.12 `Drawer`/`EmptyState` adoption · P2.13 dependency alignment.

## 4n. Responsive resilience — P1.6/1.7/1.8 + P2.13 (2026-09-02, thirteenth)

### Priority columns + row expander — the agreed design, shipped
New `ResponsiveRows` in `packages/ui/src/data/DataTable/`. Each column declares a priority:

| priority | hidden below | meaning |
|---|---:|---|
| `always` | never | row identity and its actions |
| `high` | 640px | |
| `low` | 1000px | first to go |

As the viewport narrows, low-priority columns leave the row and every affected row grows a chevron
revealing them underneath, labelled. Nothing becomes unreachable and the table never scrolls
sideways.

**Additive, not a breaking change.** `DataTable` still accepts hand-written `<thead>`/`<tbody>`, so
the other 11 tables are untouched; a table adopts this by passing `columns`/`rows` instead. That
matters because several render genuinely bespoke cells (avatar stacks, diff summaries, action
menus) and `render` keeps that freedom. The audit called a column-config API a breaking
12-table migration — making it opt-in avoids the flag day entirely.

`header` on a column accepts a `<ColumnFilter/>`, so filterable columns survive the conversion.

Styling reuses the treatment the host's Audit Logs had already defined for this exact interaction
before it was replaced by a separate viewer (the ~140 dead lines the audit found).

**Adopted on customer360 Audit Logs** as the proving ground — 7 columns, previously one of the
worst. `minWidth` removed from it deliberately: the point is that it no longer needs a scroller.

Verified in-browser by overriding `window.innerWidth` and firing `resize`:

| width | columns shown | expander |
|---:|---|---|
| 1536px | all 7 | absent (correct — nothing hidden) |
| 820px | Date & Time · Performed By · Action · Status · Details | present; opening a row revealed **Customer Reference** and **What Happened**, labelled |

### Fixed-width popovers — none can now exceed the viewport
Six controls had hard px widths and no media query, so they overflowed narrow screens. All switched
to `min(px, calc(100vw - 24px))` — the technique `Drawer` already used, and it needs no breakpoint:

`LeadFilterPopover` 520px · `TimeRangeFilterDropdown` 460px · `ApprovalsMenu` 380px ·
`SecurityAlertsMenu` 380px · `ToastNotification` 320px min · `.date-picker-popup` 310px.

### Sidebar icon-rail — 769px to 1100px
The sidebar had one breakpoint: full 240px above 768px, off-canvas drawer below. That left
769–1100px as the worst-squeezed range in the platform — full sidebar while the widest tables were
already scrolling. It now collapses to a **68px rail**, returning ~172px exactly where it is needed.

Split deliberately across two stylesheets: the host shrinks `.sidebar` and hides the wordmark,
section labels and count badges; **the shared `NavItem` hides the row label at the same
breakpoint**, because both the host's rows *and* the sub-navigation rows the remotes portal into
that same sidebar render that component — a host selector could never reach a class the shared
package hashed. The label is visually hidden, not removed, so rows stay announced.

### Remotes' overflow guards, unified
`customer360` had `overflow-x: hidden` on its scope root and `lead_mf` had nothing. Clipping is
worse than the problem — it makes anything too wide silently **unreachable** rather than scrollable.
Both now use `min-width: 0`, which is the actual fix: a flex item's default `min-width: auto`
refuses to shrink below its content, and that is what let one wide table push the page sideways.

### P2.13 — the MF singleton contract is now satisfiable
`lead_mf` declared `react: ^19.0.0` against a `requiredVersion: '^19.2.0'` singleton. pnpm happened
to hoist 19.2.8 so it worked, but a fresh lockfile could have given that remote its own React and
broken hooks across the boundary. `react`, `react-dom` and both `@types` now match the other apps.

### Verified
4/4 typecheck, 3/3 builds. Rail CSS confirmed present and correctly inactive at 1536px, targeting
`.sidebar → 68px` plus the shared `.navLabel`.

### Still open
- **P0.2 host tokenisation** (~10%) — the largest remaining consistency item.
- **P2.9 two icon systems** — host 371 shared `Icon` uses vs 34 remote files on `lucide-react`.
- **P2.10 shared `Card`** — investigated: `.lead-field-card` and `.audit-field-card` are
  **byte-identical** across the two remotes (`9px 13px` / `1.5px #e8edf5` / `10px`), and
  `.lead-section-card` and the host's `.summaryCard` are the same surface one size up. A `Card`
  with `sm`/`md` sizes is justified; not built yet.
- **P2.12** `Drawer` adoption in c360 (3 files), `EmptyState` in host (7).
- Rolling `ResponsiveRows` out to the remaining 11 tables.

## 4o. Loading states — skeletons everywhere, no spinners (2026-09-02, fourteenth)

### Why it felt worse than before
The **host** has always been skeleton-rich — 19 skeleton usages in Audit Logs, 21 in each Settings
form layer, 14 in Approval Center, plus 8 hand-built card skeletons shape-matched to specific cards
for zero layout shift. The **remotes** were spinner-based: a centred `RefreshCw` and the words
"Loading…", which collapses the page to one line and snaps it back to full height when data lands.

The one place lead did have a skeleton was worse than none: `SkeletonTable` — a standalone grid of
divs — crammed inside a single `<td>`, so it could not line up with the columns it sat in.

### New shared `TableSkeleton`
Renders `<tr>/<td>` **inside** the caller's `<DataTable>`, so header, column widths, row height,
padding and borders are the table's own — the placeholder occupies exactly the space the data will.
`SkeletonTable` (the div grid) stays for cards, where it is right.

`ResponsiveRows` also gained `loading` / `loadingRows`: the skeleton is derived from the **same
column definitions**, including which columns are currently hidden by priority, so the shape cannot
be described wrongly because it is not described twice.

### Converted — 9 loading states
| page | was | now |
|---|---|---|
| c360 Audit Logs | spinner + text | `ResponsiveRows loading` (priority-aware) |
| c360 All Products · All Interactions | spinner + text | `TableSkeleton` 8 / 7 cols |
| c360 Field Settings | `.spinner` div + text | `TableSkeleton` 9 cols |
| c360 Customer360 — inner interactions & products tables | bare text | `TableSkeleton` 6 / 7 cols |
| lead View Leads | spinner + text | `TableSkeleton` 7 cols |
| lead Field Settings | spinner + text | `TableSkeleton` 9 cols |
| lead Audit Logs | div-grid in one `<td>` | `TableSkeleton` 6 cols |

Row counts are bound to each table's page size, so the skeleton is exactly as tall as the data.

### lead dashboard cards — shaped to what each draws
All four rendered bare text. Each now gets a skeleton in its own shape:

- **Leads Over Time** — a block the height of the plot area
- **Leads by Product** — a donut circle plus five legend lines
- **Leads by Branch** — one shimmer bar per branch row
- **Recent Leads** — a 6-column `TableSkeleton`

### Spinners deliberately kept
`animate-spin` inside a **button** (`Submit`, `Refresh`, `Save Changes`) is correct — it reports the
progress of an action the user just triggered, and there is no layout to preserve. Only *page and
section* loading was converted. The host's `AppShellSkeleton` and `RouteFallback` already pair their
text with a real skeleton and were left alone.

### Verified in-browser
lead dashboard mid-load: **27 skeleton nodes, zero "Loading…" text**; the chart card holds its plot
height and the donut card shows circle + legend rather than collapsing. 4/4 typecheck, 3/3 builds.

## 4p. Shared `Card` (2026-09-02, fifteenth)

The audit found 45 card rules across the two remotes with no shared component — and the surfaces
had already converged on the same values by hand:

| | padding | border | radius |
|---|---|---|---|
| `.lead-field-card` | `9px 13px` | `1.5px #e8edf5` | `10px` |
| `.audit-field-card` | `9px 13px` | `1.5px #e8edf5` | `10px` |

**Byte-identical, in two different apps.** `.lead-section-card` and the host's `.summaryCard` are
the same surface one step apart in radius. Copying a surface by hand is precisely how it drifts.

New `Card` in `packages/ui/src/layout/`, with three sizes (`sm` field tile · `md` section/summary ·
`lg` page panel) plus `row`, `interactive` and `accent` modifiers. `#e8edf5` is kept off the token
scale deliberately — it is the host's card hairline, a touch cooler than `--omni-color-border`, and
snapping it would restyle the reference.

`interactive` (the hover lift) is opt-in rather than default: a surface that reacts to the pointer
but cannot be clicked reads as broken.

**Adopted on the 12 exact-surface usages** — 6 in c360 Audit Logs, 4 in lead's Audit drawer, 2 in
lead's Lead drawer — and the superseded `.audit-field-card` / `.lead-field-card` rules deleted from
both globals (6 rules). The `-icon` / `-body` / `-label` / `-value` children keep their own classes:
those are content layout, not the card surface.

**Verified in-browser:** the c360 audit drawer renders 6 shared cards computing `padding 9px 13px`,
`border-radius 10px`, `border-color rgb(232,237,245)`, `display flex`, `gap 15px` — identical to
what the deleted rules produced.

`packages/ui` now exports 29 modules.

### Card work still open
The remaining ~39 card rules across the two globals are *not* all the same component —
`.info-card` (c360) uses tokens and a 1px border, `.lead-kpi-highlight-card` and
`.audit-timeline-step-card` are distinct shapes. Consolidating those needs a judgement call per
card, not a sweep.

## 4q. One icon system + tokenisation (2026-09-02, sixteenth)

### Icons: three sources became one
The host drew 57 inline SVGs (371 usages); both remotes imported `lucide-react` directly, on
**different majors** (`^1.16.0` vs `^1.31.0`). Three sources, two of which disagreed with each other.

Both sets turned out to be drawn to the **same grid** — 24×24 viewBox, `stroke-width: 2`, round caps
and joins — so this was a question of source, not of redrawing.

New `@omniremit/ui/icons` subpath:
- **35 names the host already draws** export the host's own glyph, so those now render identically
  in all three apps. The reference is untouched.
- **33 names only lucide has** are re-exported from it, pinned to **one** version in `packages/ui`.
- A `withSize` shim maps lucide's `size` prop onto the hand-drawn components' `width`/`height`, so
  all 34 remote files kept their existing `<Foo size={16} />` call sites.

`lucide-react` is removed from both remotes' `package.json` — one dependency, one version, and the
majors can no longer drift apart.

**Rejected alternative:** backing the shared `Icon` with lucide would have been less work but would
have silently restyled all 371 host icons — restyling the design reference to fix the remotes is
backwards.

### Tokenisation: 10% → 42% in the host
2,160 declarations moved from hardcoded values onto `--omni-*` tokens.

| | before | after |
|---|---:|---:|
| `apps/host` | **10%** | **42%** |
| `apps/lead_mf` | 36% | **53%** |
| `apps/customer360_mf` | 14% | **37%** |
| `packages/ui` | 43% | **58%** |

**The mapping is category-constrained, and that mattered.** A naive value match produced 1,815
"opportunities" — and several were wrong: `font-size: 12px` mapped to `--omni-space-3` (a *spacing*
token) and `border-radius: 8px` to `--omni-space-2`. A property may now only take a token from its
own family, which is why the real count came out lower.

Two further rules, because a semantically wrong token is worse than a hex — it lies about intent:
- Where several tokens share a value, the specific one wins: `color: #2563eb` → `primary-600`, not
  `--omni-color-info`.
- **Ambiguous cases are skipped, not guessed.** `color: #ffffff` could be `on-primary`,
  `on-header-text` or an inverse; it is left as a hex.

`tokens.css` itself is excluded — the scale defines the values and must not reference itself.

### Verified in-browser
Host Dashboard (accent bars, donut, tinted icon tiles), Approval Center (banner, summary cards,
filters), lead dashboard (all icons render, `viewBox 0 0 24 24`, `stroke-width 2px`, zero empty
SVGs) and customer360 — all render unchanged. 4/4 typecheck, 3/3 builds.

### Still open
- `ResponsiveRows` rollout to the remaining 11 tables (proven on c360 Audit Logs).
- The ~2,400 host declarations still hardcoded are the genuinely off-scale ones — half-pixel font
  sizes (11.5/12.5/13.5), one-off shadows, gradient stops. Those need scale decisions, not a sweep.
- `Drawer` adoption in c360 (3 hand-rolled files), `EmptyState` in host (7).

## 4r. Scale extension — and the regression it caused (2026-09-02, seventeenth)

### The scale now describes the product
Tokenisation had stalled at ~42% because the scale did not cover reality: jumps of 12→13→14→16 for
type and 6→8→12→16 for radius, while the product actually uses 11.5px **101 times**, 12.5px 79,
13.5px 45, and radii of 10px 82, 9px 55, 14px 44.

Added the intermediate steps to both token files. **Extended rather than rounded on purpose:**
snapping 11.5 to 12 would have restyled the reference app in ~400 places to tidy a scale, which is
the wrong way round. The comment in `tokens.css` says so, and says not to add more.

A further **818 declarations** tokenised on the re-run:

| | start of day | now |
|---|---:|---:|
| `apps/host` | **10%** | **55%** |
| `apps/lead_mf` | 36% | **63%** |
| `apps/customer360_mf` | 14% | **46%** |
| `packages/ui` | 43% | **67%** |

### ⚠️ Regression I introduced, caught in the browser
Avatars, status dots and the legend swatch rendered as **squares** on the host dashboard.

The host does **not** consume `packages/ui/tokens.css` — it defines its own copy of the scale in
`apps/host/src/shared/styles/theme.css`. So every token I added to the shared file was **undefined
in the host**, and `var()` on an undefined custom property does not fall back to the previous value:
it makes the whole declaration invalid. `border-radius: var(--omni-radius-circle)` resolved to
nothing, so 50% became 0.

17 tokens were affected, silently — the build passed and typecheck passed, because neither resolves
custom properties. **Only looking at the page caught it.**

Fixed by mirroring the scale into `theme.css`, and `--omni-font-mono` (referenced but never defined
anywhere, surviving only on its inline fallback) is now a real token. **Undefined tokens across all
three apps: 0.**

### Guard for next time
```bash
# every --omni-* referenced must be defined in theme.css or packages/ui/tokens.css
python -c "..."   # see the check used in this pass — must print 0
```
Two definition sites for one scale is the underlying hazard. Worth collapsing the host onto
`packages/ui/tokens.css` so there is only one.

## 4s. Drawer + EmptyState adoption (2026-09-02, eighteenth)

### customer360's three hand-rolled drawers → shared `Drawer`
`CaseDetailsModal`, `ProductDetailsModal` and the Audit Record drawer each built their own overlay,
panel, gradient header and close button. All three now render the shared `Drawer`, passing
`title` / `subtitle` / `icon` / `footer`; their bodies are unchanged.

**24 CSS rules deleted** — `drawer-overlay`, `drawer-content`, `drawer-header`, `drawer-title-text`,
`drawer-close-btn`, `blue-header`, `audit-details-drawer` and the whole `audit-drawer-header` /
`audit-header-*` / `audit-drawer-footer` family. `customer360_mf/index.css` went **1,755 → 1,513
lines**.

This also inherits the shared Drawer's responsive behaviour for free: `min(700px, 94vw)` →
`100vw` at 640px, which none of the three hand-rolled versions had.

### host empty states → shared `EmptyState`
`SettingsRolesTab`, `SettingsUsersTab` and `SettingsApplicationsTab` used a local `.emptyState`
div. Now `<EmptyState compact />`.

The remaining local ones — `ApprovalsMenu`, `SecurityAlertsMenu`, `Sidebar` — are dropdown/nav
empties with different proportions to a table's, and were left rather than forced into a component
built for page and card contexts.

### Token definition sites: checked, deliberately left as two
After the squares regression, I compared `apps/host/src/shared/styles/theme.css` against
`packages/ui/src/tokens/tokens.css`: **143 vs 139 tokens and zero value mismatches** — host adds 8
`--omni-sidebar-*`, ui adds the 4 breakpoints.

Collapsing the host onto the shared file would remove the dual-maintenance hazard, but `tokens.css`
is wrapped in `@layer omni-fallback` specifically so a remote's standalone tokens can never override
the host's. Making the host's own definitions layered weakens that guarantee in a way that needs
thought, not a quick edit at the end of a session. Left as two files, in sync, with the
undefined-token check as the guard.

### Verified
4/4 typecheck, 3/3 builds, **0 undefined tokens**. The c360 audit drawer was opened in the browser
and renders correctly on the shared component — gradient header, icon, subtitle, footer, all content
intact.

### 4t. ResponsiveRows rolled out to every data table

The narrow-screen goal is now met on all nine eligible tables. Each one moved off hand-written
`<thead>`/`<tbody>` onto `ResponsiveRows`, with a priority assigned per column.

| app | table | columns | filterable headers |
|---|---|---:|---:|
| customer360 | `AuditLogs` | 7 | 4 |
| customer360 | `AllInteractions` | 7 | 3 |
| customer360 | `AllProducts` | 7 | 2 |
| lead | `ViewLeadPage` | 7 | 6 |
| lead | `AuditLogsPage` | 6 | 3 |
| lead | `RecentLeadsCard` | 6 | 0 |
| host | `MyRequestsPage` | 8 | 4 |
| host | `ApprovalCenterPage` | 9 | 8 |
| host | `AuditLogsPage` | 7 + 6 (two tabs) | 11 |

Deliberately **not** converted: both Field Settings pages (configuration forms — hiding a column
there would hide a setting) and `LeadDiffTable` (3 columns, already fits).

Because every column now declares its own `render`, the per-page `minWidth` props were dropped —
the table no longer needs a horizontal scroller, since it sheds columns instead. The `loading`
prop derives the skeleton from the same column list, so the hand-written skeleton rows in
`ApprovalCenterPage`, host `AuditLogsPage`, `MyRequestsPage`, `ViewLeadPage`, lead `AuditLogsPage`
and `RecentLeadsCard` were deleted — they can no longer drift from the real columns.

**Four defects found and fixed during the rollout**, three of which typecheck and the builds could
not have caught:

1. `ResponsiveRows` returned an **unkeyed fragment** per row (the key sat on the inner `<tr>`),
   so React warned and reconciled rows badly. Now a keyed `<Fragment>`.
2. `render` received only the row, so `ViewLeadPage` had to call `leads.indexOf(lead)` for its
   avatar palette — O(n^2) and wrong for duplicate objects. `render` now takes `(row, index)`.
3. Caller-supplied `header` nodes needed their own `key`. `ResponsiveRows` now wraps each in a
   keyed `<Fragment>`, so a caller cannot get it wrong.
4. The expander used a **text `›` glyph rotated 90deg**, which renders as an unreadable hook at
   14px. Replaced with an inline SVG chevron.

Plus one CSS fix: lead's local `.rowAction` in `RecentLeadsCard.module.css` lacked
`white-space: nowrap` (the shared `RowAction` has it), so at 480px the button read "Vie / w".

**Verified in the browser**, not just by build. lead_mf standalone at :5002, `RecentLeadsCard`, with
fixture rows injected through a `fetch` stub:

| viewport | columns shown | expander | page overflow-x |
|---:|---|---|---:|
| 1280 | all 6 | absent | 0 |
| 900 | 4 (Branch/State and Date dropped) | present | 0 |
| 480 | 3 (Product also dropped) | present | 0 |

Opening a row's expander showed the hidden columns as labelled `dt`/`dd` pairs with correct values
and a `colSpan` matching the visible column count; widening back to 1280 restored all six columns
and removed the expander. **Horizontal page overflow was 0 at every width** — the resilience goal.

One caveat for future browser checks: the Browser pane's *emulated* resize does not fire a `resize`
event, so `ResponsiveRows` will not appear to react until `window.dispatchEvent(new Event('resize'))`
is dispatched manually. A real browser resize always fires it — this is a harness artifact, not a
component bug, but it will look exactly like one.

### 4u. Seven raw tables found in `Customer360.tsx` — the audit's inventory was wrong

The audit in `sorted-snacking-rain.md` counted **12 data tables** by grepping `<DataTable`. That
undercounted: `customer360_mf/src/pages/Customer360.tsx` contained **seven** tables written as raw
`<table className="data-table">` inside a `.table-responsive-wrapper` div, styled entirely by the
app's global `index.css`. They appeared in the inventory only because their *loading skeletons*
used `DataTable` — the tables themselves never did.

So the widest table in the platform was not `ApprovalCenterPage` (9 columns) as the audit stated.
It was the individual-products table here, at **11 columns**, with no shared chrome, no overflow
policy and no `minWidth`.

All seven now render through `DataTable` + `ResponsiveRows`:

| tab | table | columns |
|---|---|---:|
| Individual | Interactions | 7 |
| Individual | Products | **11** |
| Individual | Interested Products | 4 |
| Individual | Relationship Manager | 4 |
| Corporate | Products | 9 |
| Corporate | Authorized Signatories | 5 |
| Corporate | Interested Products | 4 |

The four single-row tables are really key/value detail panels. They keep the table presentation but
now get the same narrow-screen treatment as everything else — at 480px the low-priority fields move
into the row expander instead of squeezing four or five columns into the width.

Two further latent bugs were fixed while folding their loading branches in:

- Each tab had a standalone skeleton `<DataTable>` with a **hardcoded column count** — 6, 7 and 7
  against real tables of 7, 11 and 9. Those counts were already wrong and would have drifted
  further on every future column change. All three now use `ResponsiveRows`' `loading` prop, which
  derives the skeleton from the same column list. The same fix was applied to `AllProducts` and
  `AllInteractions`.
- Removing a `loading ? <skeleton> : error ? ... : rows.length === 0 ? <empty>` chain exposes the
  empty state during the fetch, because an in-flight list is also an empty list. Every such empty
  branch is now guarded (`!loading && rows.length === 0`), so a slow fetch shows a skeleton rather
  than "No products found". This was checked on all nine originally-converted tables too — the
  three lead tables and c360 `AuditLogs` were already guarded correctly.

**Still deliberately on hand-written rows**, and correct to be: both Field Settings pages, the five
permission-matrix tables in the host's `RoleFormLayer` / `UserFormLayer` Settings drawer, and
`LeadDiffTable`. These are configuration grids — a hidden column there is a hidden setting or a
hidden permission, not a hidden detail.

### 4v. Three reported regressions, and a 189-declaration CSS bug behind two of them

#### Badge and chip backgrounds stretching across their column

`DataTable.module.css` carried a blanket rule:

```css
.table td > :where(span, div, p):only-child { display: -webkit-box; ... }
```

Intended to clamp long cell text to two lines. In practice it overrode the display of *whatever sat
alone in a cell* — and every `Badge`, status pill and action chip is an `inline-flex` element that
shrink-wraps its label. Forcing them to `-webkit-box` made them block-level, so their backgrounds
filled the whole column ("AuthService", "Login Succeeded"). `-webkit-box-orient: vertical` would
also have stacked a `Badge`'s dot above its text. This hit **every table in the platform**.

Clamping is now **opt-in** through a `clamp` flag on `ResponsiveColumn`, which wraps only that
column's content in `.cellClamp`. Set on the five columns that carry genuinely long free text:
lead audit `description`, host `MyRequestsPage` `rejectionReason`, host audit `entity`,
c360 `AllInteractions` `subject`, and `Customer360` `timeline`. Deliberately **not** set on host
audit's `device` column — it renders browser/OS pills, which is the same shape of mistake the
blanket rule made.

Verified on lead's `RecentLeadsCard`: badges are `inline-flex` again and measure 62px / 93px /
102px inside the same 138px cell — sized to their labels, not the column.

#### A duplicate sidebar and navbar drawn inside the content area

`AuthenticatedPagesLayout`'s Suspense fallback was `AppShellSkeleton`, which draws a sidebar rail
and a topbar. That is correct in `RequireAuth`, where nothing real has mounted yet — but this
boundary renders **inside** `AuthenticatedShell`, where the real Sidebar and Topbar are already on
screen. So while a page chunk loaded, a second fake sidebar and navbar were painted into the
content region.

New `PageSkeleton` draws only what a page itself owns — hero banner, 4-up stat cards, toolbar,
table header and rows — and matches the real `.content` padding (26px/28px comes from AppShell, so
the skeleton adds none of its own). `AppShellSkeleton` stays where it belongs, in `RequireAuth`.

#### 189 CSS declarations were invalid and silently dropped

The "Users by Role" donut skeleton rendered as a ring with a bar struck through it. Root cause:

```css
.sdc1 { width: 28; height: 1.1em; }   /* no unit -> declaration dropped */
```

An unitless non-zero length is invalid CSS, so the browser discarded it and the element fell back
to the shimmer default of `width: 100%` — a full-width bar across the ring.

This was not one typo. A sweep for unitless non-zero lengths found **189 dropped declarations
across 10 files**, left behind by the earlier inline-style-to-CSS-module migration:

| file | count |
|---|---:|
| `customer360_mf/pages/Customer360.module.css` | 81 |
| `host/shared/components/Skeleton/Skeleton.module.css` | **61** |
| `host/layout/SettingsDrawer/RoleFormLayer.module.css` | 16 |
| `host/layout/SettingsDrawer/UserFormLayer.module.css` | 12 |
| `host/layout/SettingsDrawer/ApplicationFormLayer.module.css` | 10 |
| 5 others | 9 |

Affected properties: `gap` (56), `width` (36), `height` (32), `border-radius` (19),
`margin-bottom` (16), `font-size` (12), `margin-top` (10), and 8 more. All now carry `px`; the
source tree greps clean at **0 remaining**. The 61 in the host's Skeleton module are the concrete
reason the skeletons had regressed — a majority of their dimensions were never being applied.

The donut skeleton was additionally reshaped to match the real chart it stands in for: ring
140x140 (was 148), and the centre is now two stacked blocks (34x24 total, 30x9 caption) mirroring
the real `donutTotalNum` / `donutTotalLabel` pair, instead of one bar.

**Verification note:** none of this was catchable by typecheck or the builds. An invalid CSS
declaration is dropped silently at parse time — `vite build` emits it, the browser discards it, and
nothing reports an error. Only measuring computed values in a real browser, or grepping the source
for unitless lengths, surfaces it.

### 4w. The skeleton regression had a second cause: two trailing rules losing the cascade

Adding `px` to the 189 unitless declarations (§4v) was necessary but **not sufficient**. Verified in
the browser, `.sdcNum` still computed to `width: 140px` instead of the `34px` the rule declared.

`Skeleton.module.css` ended with two rules appended by the same migration:

```css
/* line 552-553, the last rules in the file */
.avatar { width: var(--sk-size, 32px); height: var(--sk-size, 32px); }
.text   { width: var(--sk-width, 100%); }
```

Every per-instance modifier — `.sdcNum`, `.sdcLabel`, `.suc9` and roughly sixty others — is defined
*earlier* in the file and is a single class, so at equal specificity **source order decided and the
generic default won**. Each element carries both classes (`.shimmer .text .sdcNum`), so every
hand-tuned skeleton dimension in the host was being reset to `width: 100%` / `height: 0.82em`.

That is the actual reason the skeletons had degraded: not one broken donut, but every sized part of
every host skeleton falling back to a full-width bar.

Fixed by folding those defaults into the `.avatar` and `.text` shape variants where they belong
(lines 34 and 38), ahead of all the modifiers, and deleting the trailing copies. Modifiers now win
naturally. Confirmed in the browser: `.sdcNum` measures 34x24 and `.sdcLabel` 30x9.

**Two lessons, both already recurring in this project:**

- An invalid declaration and a lost cascade look identical from the source — the rule is right there
  in the file. Only a computed-style read in a running browser distinguishes "declared" from
  "applied". Neither typecheck nor `vite build` can see the difference.
- Appending rules to the end of a stylesheet is not neutral. For equal-specificity class selectors
  it silently inverts the intended precedence of everything above it.

### 4x. Browser verification, signed in

With a session available, all three reported issues were confirmed fixed on the host:

| check | result |
|---|---|
| Audit Logs chips | `AuthService` `inline-flex` at 97px of a 201px cell (48%); `Login Succeeded` 111px of 220px (50%) — shrink-wrapped, was 100% |
| Actor cell | avatar now inline beside the name; `box-orient: vertical` had been stacking it above |
| Donut skeleton | ring 140x140 with two stacked centre blocks (34x24, 30x9), matching the real `1 / TOTAL` — the struck-through bar is gone |
| Page loading state | during the Suspense fallback: `PageSkeleton` present, `AppShellSkeleton` absent, and exactly **one** `<aside>` and one `<nav>` — the real ones. The duplicate sidebar/navbar is gone |
| Approval Center | all 9 headers and their filter popovers render; empty state renders via the `empty` prop |

The loading state was captured by temporarily wrapping one `lazy()` import in a 6s delay, sampling
the DOM inside that window, then reverting the delay and confirming the dev server no longer serves
it. Worth reusing: React Suspense fallbacks are otherwise unobservable in dev, because a warm module
cache resolves the chunk before any sampler can run, and on a client-side navigation React keeps the
previous page visible instead of showing the fallback at all.

**Not verified:** narrow-viewport column dropping on the host. The Chrome window is maximized and
refuses programmatic resize, so `window.innerWidth` stayed at 1536. The mechanism itself was verified
on lead_mf at 1280 / 900 / 480 (§4t) and the host renders the identical shared component, but the
host's own column priorities have not been seen collapsing. Dragging the window narrow shows it.

### 4y. Lead Record Details drawer aligned with the host

Reported as "text, spacing etc. not aligning with other pages". The typography was in fact already
correct — labels and values used the same tokens as the host's `.detailRow`. The problem was one
missing rule.

**`.lead-field-card` had no base declaration block.** `lead_mf/index.css` defined
`.lead-field-card::before`, `.lead-field-card:hover::before` and `.lead-field-card-full`, but never
`.lead-field-card` itself. So every field in the drawer rendered with:

- no `display: flex` — the icon tile and the label/value body were block siblings, which is why the
  icon sat **above** its label instead of beside it
- no padding, background, border or radius — no card chrome at all
- no `position: relative`, so the absolutely-positioned `::before` accent bar resolved against a
  distant ancestor (the same failure mode as the Checkbox phantom-scroll bug)

Added, with values taken from the host's `.detailRow` in `ApprovalCenterPage.module.css`. The built
CSS is now property-for-property identical to the host's:

```
display:flex; align-items:center; gap:10px; padding:9px 12px;
background:var(--omni-color-surface); border:1.5px solid #e8edf5;
border-radius:var(--omni-radius-lg-minus);
transition:all .18s cubic-bezier(.34,1.56,.64,1);
min-width:0; position:relative; overflow:hidden
```

Verified by computed style in the running app: label 9.5px/700/uppercase/0.57em-tracking, value
12.5px/600, icon 30x30 — matching the host exactly.

An audit of every global class the drawer uses confirmed this was the **only** one missing a base
rule; the other 20 are intact.

#### One monospace face across the platform

The drawer alone carried three different monospace stacks: `.leadId` used the host's, `.monoId` a
lead-only one, and the IC number set a third **inline** (`style={{ fontFamily: ... }}`, also the last
inline style in that file, against the no-inline-CSS convention). A sweep found the problem was
platform-wide — **5 distinct hardcoded stacks across 33 declarations**, where §2.3 of the audit had
reported 3.

All 33 now resolve to `var(--omni-font-mono)`. The inline style became a `mono` prop on `FieldCard`
backed by a CSS-module class. Remaining: 36 uses of the bare token plus 2 deliberate
`var(--omni-font-mono, <stack>)` fallbacks for standalone rendering.

#### Dead CSS removed

The ~140 lines of unused expander CSS in `host/.../AuditLogsPage.module.css` (§3.3, backlog item 14)
are gone now that `DataTable` owns that treatment — 10 rules, 37,414 to 35,929 bytes. Confirmed
unreferenced in the `.tsx` first, and removed with a brace-aware parser rather than a line-anchored
regex, which had twice before orphaned fragments of multi-line selector lists. Braces balance and
all 7 remaining comma-terminated lines were checked to be intact multi-line selector lists.

#### Backlog item already resolved

`lead_mf` declares `react` / `react-dom` at `^19.2.8`, which satisfies the federation singleton's
`^19.2.0`. The version-range hazard recorded in §4 is no longer live.

### 4z. Audit detail drawers — one component, plain language, no invented data

The three "View" drawers on the audit tables (host, lead_mf, customer360_mf) were each a private copy
of the same markup. Their typography was already identical — the only value that had drifted was the
section-title pill, a step larger in both remotes (`2xs-plus` / `14px` / `4px 11px` against the host's
`2xs` / `12px` / `3.5px 10px`). What actually differed was everything else.

#### New shared component: `DetailPanel`

`packages/ui/src/data/DetailPanel/` exports `DetailSections`, `DetailSection`, `DetailGrid` and
`DetailField`, with the host's values as the reference.

The point of `DetailField` is that **a field with no value renders nothing at all**. Each app had
been making that decision separately and disagreeing: one printed "Not recorded", one an em dash,
one "System / None", and several invented a plausible default. Now a caller cannot show an empty row
or fabricate a value to fill one, because the component decides. `DetailSection` takes `hidden` so a
section whose fields all vanished vanishes too, rather than leaving a titled empty box.

#### Invented values removed

The worst of these was in customer360's drawer, which rendered:

- an **Access Channel** badge reading "CRM Core Access"
- a **Client IP** of "127.0.0.1"

Both were hardcoded in the markup, not returned by the API. Alongside them, "Customer Type" fell back
to `'Individual Profile'`, "Target Field" to `'Full Profile View'`, and lead's drawer defaulted
"User Role" to `'User'` and "Entity Type" to `'Lead'`. These are fabricated values in an audit trail
— the one place they must never appear, because the reader cannot tell them from recorded fact. All
are gone; the fields appear only when the backend supplies them.

#### Database identifiers removed

- host: **Actor ID** and **Entity ID / Key** rendered raw GUIDs. Both deleted — the actor's name and
  the record's name carry the same meaning in readable form.
- host: the **Raw User Agent** `<pre>` dump is gone; Browser and Operating System already say it.
- customer360: `actorName` was built as `` `Officer ${shortId(id)}` `` — a truncated database GUID
  presented as a person's name — falling back to the invented title "System Officer". It is now just
  the resolved name, and the field is omitted when there isn't one.
- customer360: the table's `ActorCell` had the same leak via `fallback={shortId(actor.id)}`; it now
  reads "Unknown user".

#### Vocabulary

Applied across all three drawers **and** their tables, so a column and its drawer field agree:

| was | now |
|---|---|
| Audit Record Details | Activity Details |
| Full event context, actor, and execution metadata | What happened, who did it, and when |
| Overview / Event Timeline | Summary / Timeline |
| Service | Application |
| Action | What Happened |
| Result / Status | Outcome |
| Timestamp | Date & Time |
| Actor & Authentication Context | Who Did This |
| Actor Name · Actor / Officer Name | Performed By |
| User Role | Role |
| Auth Method | Sign-in Method |
| Client IP (IPv4) | IP Address |
| Device & Environment Context | Device Used |
| Target Entity / Target Entity Context | Affected Record |
| Entity Type · Entity Name / Label | Record Type · Record Name |
| Target Field / Attribute | Field Changed |
| Event Description | Description |
| Event Details & Payload | Additional Details |
| Field-Level Modification Diffs | What Changed |
| Triggered by X / Event Completed Successfully | Started by X / Finished successfully |
| Audit Reason / Failure Reason | Reason given / Why it failed |

customer360 also gained a `formatActionLabel` that maps raw codes onto the plain-English names its
filter already defined, so the table shows "View Profile" rather than shouting `VIEW`.

#### Verified in the browser

Host and lead drawers were opened signed-in and read identically: same header, same
SUMMARY/TIMELINE pills, same field cards. Two confirmations that the empty-field rule works — the
host's "Record Name" row was absent because `entityLabel` was empty, and the whole "Device Used"
section renders only when the user agent parses.

**All three drawers have now been opened signed-in against live data** and read identically:
same header, same SUMMARY / TIMELINE pair, same field cards, same vocabulary. The customer360 service
became reachable and its drawer was verified last.

Two confirmations that the empty-field rule holds on real records:

- the host's "Record Name" row is absent when `entityLabel` is empty, and the whole "Device Used"
  section renders only when the user agent parses
- customer360's failed-search record shows **Customer Type** and **Description** but omits
  **Customer** and **Field Changed** — a failed search resolved no customer and changed no field,
  so those rows simply do not appear

Computed styles were compared between the per-app Summary block and the shared `DetailPanel` in the
same drawer, and they now agree exactly: section title 10px / 800 / 0.8px tracking / 12px margin /
3.5px 10px padding; label 9.5px / 700 / 0.57px / uppercase; value 12.5px / 600.

Two further drifts were found and fixed by that measurement:

- `.audit-detail-row` was a different size in all three apps — host `gap 10px / padding 9px 12px`,
  lead `12px / 9px 13px`, customer360 `12px / 8px 12px`. Both remotes now match the host.
- customer360's copy was missing `min-width: 0`, without which a long value cannot shrink inside the
  flex row.

customer360 also keeps an **Application** row in its Summary, reading "Customer 360". It is not read
from the record, but it is not invented either: every row on that page is the Customer 360 audit
trail, so naming the application states a fact about where the event came from, and it keeps the
Summary block structurally identical to the other two drawers.


#### One more fabricated value, caught on the second pass

`formatIpv4` in lead_mf returned `'127.0.0.1'` for a **missing** address — in three places, plus
`log.ipAddress || '127.0.0.1'` in its audit table. That asserts the action came from the server
itself. It now returns an empty string so the field is omitted. The `::1` / `::` / `localhost` →
`127.0.0.1` conversions are kept: those are genuine loopback normalisation, not invention. The host's
version already returned an em dash for an absent IP and was left alone.

#### Pre-existing issue noticed, not changed

`customer360_mf/src/services/api.ts:22` is
`const API_BASE_URL: string = 'https://omniremit.rma.com.my' || 'http://localhost:5059'`. The `||`
fallback is dead — a string literal is always truthy — so the localhost branch can never be taken and
`tsc` flags it. Left alone deliberately: which backend a remote talks to is a deployment decision.

### 4aa. The hover accent line, and the dead card family it exposed

Reported as: the Summary cards lift and show a line down their left edge on hover, the cards below
them do not.

Correct, and it was a gap I introduced. Every detail-card family in the platform already carried the
treatment — the host's `.detailRow` and `.fieldCard`, ApprovalCenter's `.fieldCard`,
`.audit-detail-row` in both remotes, and `.lead-field-card` — a 3.5px gradient rule
(`#3b82f6 -> #818cf8`) inset 20% top and bottom, `opacity 0` at rest, revealed on hover alongside a
tinted background and a `translateY(-1.5px)` lift.

The new shared `DetailPanel .field` had the background and border change but **no `::before` rule
and no lift**. So inside one drawer the Summary block showed the line and the "Who Did This" and
"Affected Record" cards immediately beneath it did not.

`.field` now carries the same `::before`, the same `:hover`, `:hover::before { opacity: 1 }`, and a
`prefers-reduced-motion` guard that drops only the transform. Confirmed in the built CSS: the
compiled `._field_*:before` is identical to `.audit-detail-row:before` — same gradient, 3.5px width,
`0 3px 3px 0` radius, `opacity .18s` transition — and the reduced-motion override sits inside its
media block rather than leaking out.

Not extended to the shared `Card`. Its `.interactive` hover is deliberately opt-in, with the reason
recorded in the file: a surface that reacts to the pointer but cannot be clicked reads as broken.
`Card.accent` is also a different convention — a rule along the **top** edge, always visible, which
is what the KPI tiles use.

#### 16 dead rules removed

Replacing the three drawers' hand-written cards with `DetailPanel` left the whole
`.audit-field-card*` family unreferenced — `-grid`, `-icon`, `-body`, `-label`, `-value`, `-full`,
`::before`, `:hover::before`, plus a media query that had nothing left to style. Zero references in
any `.tsx`/`.ts`. Removed from both remotes: 8 rules each, `index.css` down 1,327 bytes in lead_mf
and 1,327 in customer360_mf. Braces verified balanced in both.

**Not confirmed by pointer:** the Chrome window minimised itself to 0x0 again (a lingering effect of
the earlier programmatic resizes) and would not restore, so the hover could not be driven with a real
cursor. The rule was verified three ways instead — computed `::before` on the live card in the open
drawer (3.5px, correct gradient, `opacity: 0` at rest), the compiled CSS matching `.audit-detail-row`
declaration for declaration, and the reduced-motion scoping. Restoring the window and hovering a
"Performed By" card is the last visual check.

### 4ab. Search recommendations everywhere, and the commit/query split (2026-09-08)

Two rounds of work on the same theme: every search box should recommend as you type, and typing
should never move the table underneath you.

#### Three new shared pieces

| file | what it owns |
|---|---|
| `packages/ui/src/hooks/useSuggestions.ts` | debounce + substring match + dedupe + cap, with `numeric` digit-only matching and `exclude` |
| `packages/ui/src/hooks/useCommittedFilter.ts` | splits `query` (what you type) from `applied` (what the table filters by) |
| `ColumnFilter`'s `suggestFrom` prop | one prop turns a free-text column into a recommending one |

`suggestFrom` exists because the explicit path — raw state, debounced derivation, a `useMemo`
building `ColumnFilterOption[]`, two props — costs ~12 lines per column. Across ~40 sites that is
unshippable, which is why nine of the platform's ten free-text columns still said nothing but
"Press Enter to apply". Explicit `suggestions` still wins where a call site wants richer rows.

#### Wired

10 free-text `ColumnFilter`s across all three apps; the Lead Directory toolbar search (the only
`SearchField` still submit-only); the Settings drawer's Roles / Applications / Checker-assignment
toolbars, migrated onto the shared `SearchField` (their local `.searchWrap`/`.searchInput`/
`.searchIcon`/`.clearSearchBtn` rules are deleted, not shadowed); `LeadFilterPopover`'s IC / Phone /
Name tabs, which had a bare box and no list at all; and Customer 360's two identity lookups, which
keep Enter-to-submit — a partial NRIC/BRN is not a meaningful server query — and instead recommend
from `useRecentLookups`, a per-browser record of lookups that actually resolved.

**Every pool comes from rows already loaded.** Verified by counting `fetch`: opening a filter and
typing ten characters issues **zero** extra requests.

#### The commit/query split — typing must not filter the table

Actor, Record, IP and Device in host Audit Logs, and Maker, Checker and Record in Approval Center,
bound the box *directly* to the fetch dependency. Every debounce tick re-queried the table while
simultaneously re-narrowing the "known values" list you were reading: four characters of a name
reshuffled the rows three times before you reached the one you were aiming at, and the list moved
while you read it.

`useCommittedFilter` separates them. Typing narrows suggestions only; the table changes once, on a
pick or on **Enter** — Enter is deliberate, it is the escape hatch that keeps free-text working for
a value with no suggestion behind it. Measured live: typing 5 characters → **0 API calls**, table
untouched; picking → **1**.

Application / Action / Auth / Outcome never had the problem — their boxes only ever narrowed a list
and the filter changed on click. Worth knowing before "fixing" them.

`useSuggestions`' `exclude` (and `narrowByName`'s third argument) drops the value already applied
from its own list: re-picking it is a no-op that displaces a real alternative.

#### Still live-filtering, by decision

Toolbar quick-search (Users, Lead Directory, six in Customer 360) still filters as you type. The
rule settled on is **column and header filters commit on selection; toolbar quick-search filters
live** — in a toolbar the dropdown covers the table anyway, so the "both moving" problem is not
visible, and a search box that does nothing until Enter reads as broken. Flagged to the user as an
open choice.

#### Bugs this surfaced

1. **Masked data leaking into suggestions.** The lead name column's second line printed IC numbers
   in full that the table masks as `*******9184`. Suggestions are the same data by another route, so
   they now honour the same `sensitive`/`visible` field config — a masked field gets **no pool at
   all**. Applies to `ViewLeadPage` and `LeadFilterPopover`.
2. **Phone suggestions matched nothing.** Rows store a doubled `+60 +60 17-234 5678` (the reason
   `formatPhone` exists) and the filter box strips `+`, so the stored string was neither what the
   cell shows nor something the box could hold — it displayed a doubled prefix and returned 0 rows
   when picked. `SuggestionSource` gained an optional `label` so display and committed value can
   differ: label as the table reads, commit what the box would have produced.
3. **A hooks crash I introduced.** `LeadFilterPopover` has an early `return null` and my hooks sat
   below it — "Rendered more hooks than during the previous render". Hook-shaped code in that file
   must stay above the bail-out.
4. **Duplicate React keys** on the Users dropdown: `id` was the user's name and two users are called
   Tushar. Now the user id, with the handler resolving it back to the name.
5. **Long text overflowed the popover** instead of ellipsing. `.item`'s text span is a flex item and
   defaults to `min-width: auto`, so it refused to shrink; `.itemBody` sets `min-width: 0`.
6. **A regression from round one:** I had pointed the Service list at the *applied* filter instead of
   its search box, breaking that box's narrowing. `serviceSearch` and `service` are two different
   things in that file, unlike the actor/IP/device popovers where the box is the filter.

#### Tab-bar parity, and why the first attempt missed it

User Detail's `.navBar` was missing Approval Center's `border-top: 3.5px solid
var(--omni-color-primary-600)`. The first pass compared the two with a `getComputedStyle` probe
reading `.border` — **that property returns an empty string as soon as the four sides differ**, so
it reported nothing for both pages and every other value matched. Read borders per side.

#### Settings drawer navigation

- **Closing always went to the dashboard.** `SettingsDrawer`'s close was a hard-coded
  `navigate('/')`. The store now carries `returnPath`, recorded in `AuthenticatedShell` for every
  non-drawer route (see `isDrawerRoute`), so all entry points — gear, sidebar, global search,
  bookmark — return where they came from. `/` remains the fallback for a cold deep-link.
- **Saving a user landed on an empty settings overlay.** All four exits in `UserFormLayer` called
  `resetToRoot('users')`, which reopens the drawer on its Users tab — but that panel was removed when
  Users became real pages (`SettingsDrawer` has no `activeTab === 'users'` branch), so the body
  rendered blank. They now close and navigate: back to the detail page if Edit was pressed there,
  the list otherwise.

#### Verified in-browser

Tab bar measured per-side against Approval Center (identical). Audit Logs and Approval Center: 0
calls while typing, 1 on pick, applied value absent from its own list. Column search picking and
filtering on host, lead and c360. Numeric matching (`172345678` → `+60 17-234 5678`). Settings
opened from Audit Logs and closed → back on `/system/audit-logs`. User edited from the detail page
and saved → back on the detail page with updated values. 4/4 typecheck; a fresh tab loads host and
lead_mf with **zero console errors**.

#### Deliberately not done

`CapabilityPicker` got the missing debounce but no floating dropdown — its grouped, tickable list
*is* the result, so a popover would cover the rows it filters and offer nothing selectable.

## 5. Known remaining work

- **Auto-generated class names in the host** — `styles.suc1`, `ufl3`, `rfl7`, `afl2`, `alp1`, `dp2`
  etc. in the Skeleton components and Settings form layers still carry generated names. lead_mf and
  customer360_mf were renamed semantically; the host was not.
- **customer360 class names** were renamed by a *heuristic* (`.panel`, `.row`, `.stack`, `.spread`,
  `.box2`…) — readable but not always meaningful. Worth a human pass.
- `lead_mf/index.css` (2,031) and `customer360_mf/index.css` (~1,990) still hold global layout and
  utility rules. Component styling is out; further decomposition is optional.
- 3 pre-existing lint warnings in host files untouched by this work.
- No test suite exists anywhere in the repo.
- **`Customer360Service` still needs a restart** for the `ClaimTypes.Name` -> `JwtClaimTypes.Name`
  fix in `AuditController.cs` to take effect; until then c360 audit rows fall back to
  `resolveActor`, which shows an id rather than inventing a name.
- The two Field Settings tables and `LeadDiffTable` remain on hand-written rows by design.
- **Toolbar quick-search still filters live** while column/header filters commit on selection — a
  deliberate split (§4ab), raised with the user and awaiting their call on whether to unify.
- **`ColumnFilter` free-text suggestions only see rows already loaded.** On the two server-paged
  audit tables that means recommendations cover the current page, the same scope those columns'
  filters already had. Widening it needs server-side suggestion endpoints.
- **`resolveActor` / c360 audit** — unchanged from §4e: only the current user's id resolves.

## 6. Related context
- Plans: `C:\Users\udayo\.claude\plans\host-remote-apps-sunny-waffle.md`,
  `C:\Users\udayo\.claude\plans\tingly-humming-tide.md` (the §4ab search work).
- Graphify graph: `graphify-out/graph.json` — **5,169 nodes / 10,910 edges / 253 communities**,
  re-extracted 2026-09-08 after §4ab (was 4,209 / 8,289). Rebuild with
  `graphify update .` from `OmniRemit/` — AST only, no LLM, no API cost.
  Note it is AST-only — **no cross-service HTTP edges**, so "no path" ≠ "unrelated".
