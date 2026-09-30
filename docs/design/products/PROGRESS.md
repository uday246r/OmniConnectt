# Progress — Products & Marketplace rebuild

Last updated 2026-09-30. Read [BRIEF.md](BRIEF.md) for the plan and the reasoning behind it.

| Phase | State |
|---|---|
| **1 — Schema and catalog APIs** (`Backend/ProductsService`) | **Done and verified**, on local branch `products-rebuild`, not pushed. 280 unit tests pass, and 53 end-to-end checks pass against a real PostgreSQL 17 (below). |
| 2 — Admin UI (`Frontend/apps/products_and_marketplace_mf`) | **In progress** (see "Phase 2 status" below). Categories and Audit Logs are done and verified in a browser; the other screens are not built yet, so the remote shows only those two. |
| 3 — Dashboard and audit screens | Not started. The backend for them is done. |
| 4 — Lead Management integration | Not started. Do not start until 2 and 3 are green. |

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


## Phase 2 status (frontend) — updated 2026-09-30

**Done, committed, type-checks, 45 unit tests pass, and verified in a browser against the real API:**

- The demolition of the retired screens and of every hand-rolled component the shared library replaces.
- The data layer: types, one API module per resource, `createPagedStore` (fetch/cancel/stale-response logic,
  tested), stores for categories, sub-categories, products, the dashboard, the category → sub-category pickers,
  and statuses (a badge re-renders only when *its* status changes; nothing compares a status to a literal).
- Shared components: `StatusBadge`, `CatalogIcon`, `IconPicker`, `RowMenu`, `ConfirmDialog`, `Toasts`, `KpiTile`,
  `Field`, `TextArea`, `ListToolbar`, `useSaveAction`.
- **Categories** (list, search, filters, sort, paging, add/edit drawer, row menu, reorder, delete with the
  server's refusal shown in the dialog) and **Audit Logs**.

**Not built yet** (each is registered by adding it to the `PAGES` map in `src/App.tsx`):

1. **Sub-categories** page — the Categories screen plus a Category column and a category filter; its form picks a category.
2. **Products** page — category tabs with counts, search and sub-category/status filters, the card grid of mockup 2,
   the add/edit drawer that renders its fields *from the chosen sub-category's field definitions*
   (`subCategoryApi.get(id).fieldDefinitions`; validate with `@omniconnect/ui/validation`'s `validateFieldValue`
   and show the server's `fieldErrors` from `useSaveAction`), a details drawer, status change and delete.
3. **Dashboard** — the KPI tiles (`KpiTile`), a products-by-category bar chart, a status donut, recent products and recent
   activity. The charts do not exist yet; write them as small SVG components coloured from CSS variables.
4. **Setup** — tabs for Fields (per sub-category, reusing `@omniconnect/ui/validation-editor`'s
   `ValidationRulesEditor` for a field's format rules), Documents, and Statuses (group `useStatusConfigStore().configs`
   by `entityType`; each has label, colour, enabled, and the new **isLive** switch).
5. Component tests for what is built (`StatusBadge`, `ListToolbar`, `ConfirmDialog`, `RowMenu`, the pages),
   a rewrite of this app's `README.md` (it is wrong about the port and files), and a final build and lint.

**How to look at it.** The remote needs a host, so it cannot be opened on its own. For local checking, a harness
page installs a stand-in `window.__omniconnectHost__` (a signed test token and a full grant) and loads the built
remote: start the API against a throwaway Postgres (see "What was verified"), run `products-mf-dev`, and serve the
harness from another port. Screenshots lag one action behind, so wait a beat before taking one.

**Deliberately not in the mockups' implementation:** the checkbox column in the tables (there is no bulk action
to attach it to), and the top bar and sidebar (they belong to the host shell, not this remote).
