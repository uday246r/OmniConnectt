# Progress — Products & Marketplace rebuild

Last updated 2026-09-30. Read [BRIEF.md](BRIEF.md) for the plan and the reasoning behind it.

| Phase | State |
|---|---|
| **1 — Schema and catalog APIs** (`Backend/ProductsService`) | **Done and verified**, on local branch `products-rebuild`, not pushed. 280 unit tests pass, and 53 end-to-end checks pass against a real PostgreSQL 17 (below). |
| 2 — Admin UI (`Frontend/apps/products_and_marketplace_mf`) | **Done and verified**, on the same local branch. All six screens built on `@omniconnect/ui`; 130 unit tests pass; type-check, build and lint are clean; each screen was exercised in a browser against the real API and PostgreSQL. |
| 3 — Dashboard and audit screens | **Done** (built as part of Phase 2). |
| 4 — Lead Management integration | **Done and verified** on the same local branch (2026-09-30): Lead Management now offers Category → Product from the Marketplace. See [Phase 4](#phase-4--lead-management-done-2026-09-30) below and [IMPLEMENTATION-REPORT.md](IMPLEMENTATION-REPORT.md). |

## Before running anything

**The old database cannot be migrated forward.** The schema was rebuilt from scratch: one `InitialCreate`
plus `BootstrapStatuses`. A database created by the earlier design has the same table names and a
different migration history, so `dotnet run` logs "The database could not be prepared" and the first
request fails. Use an empty database, or drop the schema first:

```sql
DROP SCHEMA public CASCADE; CREATE SCHEMA public;
```

That permanently deletes everything in it. The Neon databases are shared — check which one
`Backend/ProductsService/.env` points at before running it. Nothing in this rebuild was run against one.

## What was verified

**Unit tests:** 280 pass. They use EF's in-memory provider, which does not enforce unique indexes, foreign
keys or cascades, so on their own they proved logic, not the database.

**Against a real PostgreSQL 17** (a throwaway Docker container, deleted afterwards — nothing shared was
touched): the service was started on an empty database, so both migrations were applied for real, and 53
checks were driven through the actual HTTP API with signed tokens. All passed. They covered:

- the schema: 11 tables, both migrations recorded, the 8 bootstrap statuses, `ValidationsJson` genuinely `jsonb`
- the hierarchy and its uniqueness rules (a code across the catalogue; a name within a category)
- **the core requirement:** a category set inactive hides its products from the customer view while the
  admin list keeps them; *nothing beneath it is rewritten in the database*; reactivating restores each
  product exactly as it was, so a draft stays a draft
- server-side value validation, with every failing field reported together
- SQL translation of the sorts and searches, the atomic view counter, and cascade delete
- updating a product that has values (the bug the in-memory tests exposed)
- eight simultaneous requests for one code: exactly one 201 and seven plain 400s, never a 500
- the guard rails (deleting what still has children; the only live status; a status still in use)
- the dashboard endpoints, the audit trail, and access control (401 anonymous, 403 for a reader)

Also checked: the service starts with its dependency graph valid, and `GET /permissions` publishes the six
sidebar pages in mockup order.

**Not verified:** anything involving AuthService. Approval (maker-checker) was not exercised — the test tokens
were administrators, who bypass it — nor the download endpoints (which ask AuthService for a fine-grained
capability), nor loading admin-defined formats from Manage Formats. Those paths are unchanged from before the
rebuild and their unit tests pass, but they were not run against a live AuthService.

## Known follow-ups

- **Log noise.** ASP.NET logs every exception its handler catches at *Error* level, including the ones this
  service deliberately turns into a 400 (a duplicate code, deleting something that still has children). One
  end-to-end run produced 17 "unhandled exception" lines and not one real failure. That was already true
  before the rebuild, but at scale it would bury genuine errors and can trip alerts. The fix is to return
  400s directly instead of throwing, or to log those at a lower level in the exception handler in `Program.cs`.
- **The Products frontend is broken** until Phase 2, because it still calls the old API.

## Where this departs from BRIEF.md, and why

| Plan said | Done | Why |
|---|---|---|
| `SubCategory` keeps `ApplyButtonLabel`, `AmountFieldLabel` | Dropped, and `ShortLabel` | Their only consumer was the deleted Apply flow. They were also the source of the literal `"Apply Now"` / `"Requested Amount"`, re-defaulted in six places. |
| `Product` gets a `DisplayOrder` | Not added | Nothing in the mockups orders products by hand; they sort by name, newest, or a metric. |
| Keep `ProductViewLog` | Deleted | Nothing reads it any more, and it wrote a row on every product view — an unbounded table growing with traffic. `Product.ViewCount` (an atomic increment) stays. |
| Sub-category code unique *per category* | Unique across the whole catalogue | A code has to name one sub-category unambiguously in reports and on a lead. |
| Cursor pagination | Numbered pages (offset), page size capped at 100 | The mockups show "Showing 1 to 10 of 28" with numbered pages, which needs a total. Revisit for the lead picker if it needs infinite scroll; the `(SubCategoryId, Status, CreatedAt, Id)` index already supports keyset. |
| Capability module `sub-categories` | Module `subcategories`, page route `sub-categories` | Module keys are embedded in `remote.{app}.{module}:{Capability}` and every other module in the platform is one lowercase word. |
| Feature tags: the first two benefits | All benefit titles | How many fit on a card is the card's decision, not the API's. |
| `StatusConfig` unchanged | Added `IsLive` | Needed so "visible" is defined by Setup, not by the word "Active". |
| Dashboard KPIs with labels | Keys only (`totalProducts`, …) | What to call a figure is the screen's decision. |

Also added, not in the plan: server-side validation of a product's attribute values; a `recent-activity`
dashboard endpoint (the mockup has a feed and the audit endpoint needs a different capability); and two
safety rules in Setup → Statuses (a status still held by records cannot be deleted; the only live status
cannot be removed or made not live).

## The API Phase 2 builds against

All under `/api`, all `[Authorize]` and capability-guarded, every mutation approval-gated as before.
Lists return `{ items, page, pageSize, totalCount, totalPages }`.

| Endpoint | Notes |
|---|---|
| `GET categories` | `search`, `status`, `sort` (`order` default, `name`, `-name`, `created`, `-created`, `products`, `-products`), `page`, `pageSize` (default 10). Each row: `subCategoryCount`, `productCount`, `isLive`. |
| `GET/POST/PUT/DELETE categories/{id}`, `POST categories/{id}/reorder` | `reorder` takes `{ direction: "up" \| "down" }`. Delete is refused while it has sub-categories. |
| `GET sub-categories` | Same query, plus `categoryId`. |
| `GET sub-categories/{id}` | Returns the detail, including `fieldDefinitions` — what the product form renders from. |
| `POST/PUT/DELETE sub-categories[/{id}]`, `POST …/reorder` | Update may move it to another category; its products follow. Delete is refused while it has products. |
| `POST sub-categories/{id}/fields`, `PUT/DELETE …/fields/{fieldId}` | Each returns the whole sub-category detail. |
| `GET products` | `search`, `categoryId`, `subCategoryId`, `status`, **`visibleOnly`**, `sort` (`newest` default, `oldest`, `name`, `-name`, `primary-metric`, `-primary-metric`), `page`, `pageSize` (default 12). |
| `GET products/status-counts`, `GET products/export`, `GET/POST/PUT/DELETE products[/{id}]`, `PATCH products/{id}/status` | `visibleOnly` is what the lead form must send: the admin list omits it and sees hidden products too, so they can be managed. |
| `GET dashboard/summary?days=30` | Figures carry `key`, `value`, `changePercent`. |
| `GET dashboard/product-breakdown[?categoryId=]` | Per category; per sub-category when one is given. |
| `GET dashboard/{product-status-distribution,recent-products,recent-activity,top-searches}` | `take` is capped at 50. |
| `GET status-configs`, `document-definitions[?subCategoryId=]`, `audit-logs` | Unchanged, apart from `isLive` on statuses and `subCategoryId` on documents. |

**Errors.** A 400 is `application/problem+json` with `message`. When a product's attribute values fail their
rules it also carries `errors`, a map of field key → message, listing *every* failing field at once.

**Statuses.** `Status` on a record is the value as Setup spells it. Its label and colour come from
`GET status-configs`; whether it is live comes from `isLive`. The frontend must never compare a status to a
literal. A record also carries `isVisible` (products) or `isLive` (categories, sub-categories).

## Next step

Phase 2. Start with the backend contract above and the four mockups in this folder. The hardcoding to
remove is inventoried in [CODEBASE-FACTS.md](CODEBASE-FACTS.md) — start with `src/data/countries.ts`,
which is 151 hardcoded rows and also drives phone-number validation. The `useShallow` selector rule,
the `@omniconnect/ui/tokens.css`-before-local-CSS rule and the `.test.tsx` naming rule in `CLAUDE.md` all
apply.


## Phase 2 status (frontend) — 2026-09-30: done

**Built:** Dashboard, Products, Categories, Sub-categories, Setup (Fields, Documents, Statuses) and Audit Logs.
`Frontend/apps/products_and_marketplace_mf/README.md` describes the structure and conventions.

**Verified in a browser** against the real API and a throwaway PostgreSQL 17 (a stand-in host bridge with a signed
test token loads the built remote): the Categories list, add form with validation, row menu, and the server's
refusal to delete a category that has sub-categories (shown in the dialog); the Products grid with live tab
counts; the add form's category → sub-category cascade, the chosen sub-category's own attributes appearing with
their units, the client catching a bad value, and a successful create updating the grid and counts; Setup →
Statuses refusing to switch off the only live status; the Dashboard's tiles, bar chart and donut; Sub-categories;
Audit Logs listing the actions just performed, and Setup → Fields (list, open editor, save an edit). All requests on those page loads returned 200.

**Checks:** 130 unit tests across 11 files; `tsc` reports 0 errors; the production bundle builds; `oxlint`
reports 7 warnings and no errors (the "set loading state inside an effect" pattern the codebase already used,
plus one pre-existing in `PermissionContext`).

**Not verified, or not done:**

- **Approval (maker-checker) in the UI.** Every test token was an administrator, who bypasses it. The code path is
  unit-tested (`ConfirmDialog`, `httpClient`, `useSaveAction`) but was not exercised against a live AuthService.
- **Formats from Manage Formats** cannot be picked in the field editor (they live in AuthService and the app has no way
  to read them); built-in formats work and the server still enforces any a field uses.
- ~~Setup → Documents was not exercised; Fields add/delete/format rule were not driven.~~ **Done on 2026-09-30**
  (during Phase 4): a document was added, edited and deleted; a field was added with a "Digits only" format and
  deleted. All in the real host.
- ~~Real host.~~ **Done on 2026-09-30**: the remote loads inside the actual host shell (sidebar, routing, theme) with the
  real AuthService, registered through Setup → Applications.
- Row checkboxes from the mockups are not built (no bulk action to drive), and the top bar and sidebar belong to the host.

## Phase 4 — Lead Management (done 2026-09-30)

**Built.** LeadService no longer has products of its own. ProductsService publishes the catalogue on
`internal/catalog/*` (own key, `Internal:CatalogApiKey`); LeadService reads it server-to-server
(`ProductCatalogClient`), serves `GET /api/catalog/{categories, categories/{id}/products, sub-categories}` to
`lead_mf`, and the lead form's first step is a Category → Product picker. A lead stores the catalogue product id
plus a snapshot (product, sub-category, category names and codes). Field Settings are keyed by sub-category and
created on first use; the property/business detail fields exist for every sub-category, hidden until switched on.

**Verified** (whole platform on a throwaway PostgreSQL 17, the *real* AuthService and the *real* host shell, torn
down afterwards): Categories add; Setup → Documents add/edit/delete; Setup → Fields add (with a format rule) and
delete; Lead → Create Lead: categories and products come from the Marketplace, the lead was created and its
snapshot is in the database; Field Settings tabs per sub-category, switching Property Type on/required made the
Property Details section appear on the Home Loan lead form; edit and move a lead to another product; product
filter; dashboard; **switching the Loans category to inactive removed it from the picker and a lead for its product
was refused ("no longer offered"), reactivating restored both**; **stopping ProductsService left the pickers working
from the last list read and made lead creation answer 503**; the migration, applied to a database in the old shape
with legacy leads, kept each lead's product name and code and cleared the old field configs; CSV exports (as an
administrator). 107 LeadService and 289 ProductsService unit tests, 61 lead_mf tests.

**Still not verified.** Maker-checker approvals end to end (every session token was an administrator; the
approval replay of a lead create is covered by a unit test that rebuilds the stored request and re-confirms the
product); the fine-grained export capability for a *non*-administrator; a lead user who holds only lead
permissions; Setup → Fields' Manage Formats picker (known gap).

**Deviations from the plan** — see IMPLEMENTATION-REPORT.md §7: product-specific lead questions stayed the five
existing fields (made per-sub-category and hidden by default) instead of a generic attribute table; the catalogue
has its own key rather than reusing the approval-replay key; the product filter reads the leads' own snapshot.

**Data note.** Existing leads keep their product name and code but have no catalogue id; every old
`LeadFieldConfig` row is deleted by the migration and recreated on first use. Pending approvals that were queued
before this change (a lead create carrying a product *name*, a field-settings change for an old product id) cannot
be applied and must be re-submitted.
