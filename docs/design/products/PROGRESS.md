# Progress — Products & Marketplace rebuild

Last updated 2026-09-30. Read [BRIEF.md](BRIEF.md) for the plan and the reasoning behind it.

| Phase | State |
|---|---|
| **1 — Schema and catalog APIs** (`Backend/ProductsService`) | **Done**, on local branch `products-rebuild`, not pushed. 280 tests pass. Not yet run against a real database (see below). |
| 2 — Admin UI (`Frontend/apps/products_and_marketplace_mf`) | Not started. **The remote is broken until it is** — it still calls the old API. |
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

## What was verified, and what was not

Verified: the class libraries and API build; all 280 tests pass; the service starts and its dependency
graph validates; `GET /permissions` publishes the six sidebar pages in mockup order; every data endpoint
answers 401 to an anonymous caller; `dotnet ef migrations script` produces sound SQL (11 tables, one
`jsonb` column, the unique indexes, `RESTRICT` on the two hierarchy links, 8 bootstrap status rows).

**Not verified: any of this against a real PostgreSQL.** The tests use EF's in-memory provider, which does
not enforce unique indexes, foreign keys or cascades, and translates some queries more leniently than
Npgsql. The first run against an empty Postgres is the real test of the migration, the unique-violation
handling (`SaveOrReportDuplicateAsync`), the `ExecuteUpdate` view counter and the index-backed queries.

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
