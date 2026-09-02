# Shared UI Refactor — Status & Handoff

**As of:** 2026-09-02 · **Branch:** `main` (uncommitted, 148 files changed) · **Nothing committed.**

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

### Shared components (17)
`Button` (+`onHeader` variant), `Badge`, `Input`, `Checkbox`, `Switch`, `Tabs`, `Icon` (57 inline
SVGs), `DataTable` (+`bare`, `Empty`), `Pagination`, `EmptyState`, `PageHeader`, `Drawer`
(+`tone="danger"`), `Modal`, `Skeleton`×4, `classNames`, `formatDate`/`formatDateTime`/
`formatTime`/`formatRelativeTime`.

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
Prereqs: Azure SQL firewall must allow the dev machine's current public IP (error 40615 blocks all
four backends), then all four services on 5155 / 5200 / 5046 / 5059 return `/health` 200.

The Browser pane is a **separate browser with its own cookie jar** — a sign-in in the user's own
browser does not carry over. The user must sign in *in the pane*; the assistant must not type
credentials.

---

## 4. Also changed (backend, unrelated to CSS)

`AuthService`, `ModuleRegistry`, `Customer360Service` `Program.cs` — startup migration/seed is now
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

## 6. Related context
- Plan: `C:\Users\udayo\.claude\plans\host-remote-apps-sunny-waffle.md`
- Graphify graph: `graphify-out/graph.json` (4,209 nodes / 8,289 edges, updated post-refactor).
  Note it is AST-only — **no cross-service HTTP edges**, so "no path" ≠ "unrelated".
