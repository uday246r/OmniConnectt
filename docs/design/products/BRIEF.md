# Design brief — Products & Marketplace rebuild

> **Status:** Phase 1 (the backend) is done. See [PROGRESS.md](PROGRESS.md) for what was built, where it departs from
> the plan below, and the API the frontend builds against. [PHASE-1-EXECUTION.md](PHASE-1-EXECUTION.md) now describes
> the service *as it was before* the rebuild.

> This file and the images beside it are the **only** reference an unattended cloud run has.
> Read this file and all four images before writing any code.

## Screen mockups

| Image | Screen | Shows |
|---|---|---|
| `01-dashboard.webp` | Dashboard | Blue hero banner + Add Product; 5 KPI tiles (Total Products, Active, Draft, Total Categories, Total Sub-categories) each with a month-over-month delta; Products-by-Category bar chart; Product Status donut; Recently Added Products table; Recent Activity feed |
| `02-products.webp` | Products | Category tab strip with live counts; search + Category / Sub-category / Status filters; product cards showing breadcrumb `Category > Sub-category`, status pill, two key/value attribute rows, feature tags, View Details / Edit, and the product code |
| `03-categories.webp` | Categories | Table: name + icon, code, description, status, total products, created date, row actions; search, status filter, sort, pagination |
| `04-sub-categories.webp` | Sub-categories | Same table shape plus a **Category** column — Home Loan `LN-HM`, Car Loan `LN-CR`, Personal Loan `LN-PS` under Loans; Cashback `CCB`, Reward Points `CCR`, Premium `CCP` under Credit Cards |

Sidebar in the mockups: **Dashboard · Products · Categories · Sub-categories · Setup · Audit Logs**.
Promotions and Applications are gone.

Note the mockups disagree on counts (image 1 says 5 categories / 14 sub-categories, image 3 shows 8,
image 4 shows 28). All counts are live aggregates; do not take any number in an image as fixed data.

## The original request, verbatim

> I want you to deeply analyze the code structure of all the host and remote apps of this particular
> repo OmniConnect and I want you to redesign the whole product marketplace like the images that I
> have provided. In the current scenario the product marketplace has many things. I want you to
> redesign the whole database schemas, backend APIs and frontend also. I want you to not hard code
> anything, follow industry standards and make it an enterprise level application so that if millions
> of users reach this application it should not crash.
>
> In the product marketplace: a category like Credit Card, a category like Loan. A category can have
> sub-categories, and can have products. Adding a product should ask which category it belongs to —
> so if I add Home Loan, I say it belongs to the Loan category. If in future I want a category removed
> from the UI, I just mark the category inactive and all the products of that category are removed
> from the UI.
>
> The audit log section and the setup section should have all the configurable fields. The category
> section has all the categories, the product section has the products configured by category.
>
> Deep dive into how other banks use this, because we are making this application for a bank — whether
> a category is needed or not, whether a sub-category is needed. Explain how it is needed and how it
> should be differentiated from a product: if I add Loan as a category, can Home Loan be a product
> also? What is the use of a sub-category? If a sub-category is not needed, don't add it.
>
> Remove everything it currently has — the database schemas and everything stored in the database.
> New schema, new tables, new APIs, new UI design, new backend. Remove all dead code and all previous
> code that is not in use.
>
> This product marketplace should be linked with Lead Management. When I create a lead it asks which
> product the lead is for, and that product should come from this product marketplace. In the lead
> form it should render all the products present in the product marketplace based on category: it
> asks which category, I select the category, it shows all the products, I click a product, then the
> lead form opens and I create the lead. The rest of the process stays as it is.
>
> Don't hard code anything — everything should be dynamic and fetched from the database or backend,
> not hardcoded in the frontend or anywhere.

---

# Products & Marketplace: rebuild the catalog and wire it into Lead Management

## Context

The Products & Marketplace remote (`Frontend/apps/products_and_marketplace_mf`, ~10.4k LOC) and
`Backend/ProductsService` (~16.6k LOC, clean architecture) work, but the domain model does not match
how a bank actually sells products, and a large amount of behaviour is compiled in rather than
configured.

Three concrete problems:

1. **Two parallel classification axes.** `Category` is already self-referencing
   (`ParentCategoryId` → `SubCategories`) but sub-categories are never surfaced — `subCategoryCount`
   is rendered in four places with no CRUD behind it. Separately, `ProductType` (Loan, Credit Card,
   Fixed Deposit) carries the `FieldDefinition`s, `DocumentDefinition`s and apply labels. Every
   product is therefore classified twice.
2. **Hardcoding.** `SeedData.cs` is 614 lines of a fixed Indian retail-banking catalog (20 product
   codes, 32 field keys, fake customers, a `switch` on product-type code producing button labels),
   and part of it runs in production (`Program.cs:163`). The frontend hardcodes 151 countries with
   dial codes and phone-length validation (`src/data/countries.ts`), icon lists, status→tone maps,
   `₹` as the currency, and chart palettes.
3. **Lead Management is disconnected.** LeadService owns a *private* `Products` table — 7 rows
   hardcoded into a migration seed (`ApplicationDbContext.cs:91-102`), with no category concept.
   `CreateLeadDto.Product` is a **name string** resolved case-insensitively against that table
   (`LeadService.cs:84-85`). Creating a lead offers one flat dropdown (`ProductSelector.tsx`, 31
   lines).

**Intended outcome:** one three-level taxonomy, a catalog that is entirely database-driven, and a
lead-creation flow that starts from that catalog — Category → Product → lead form.

## Target domain model

```
Category          Loans                        line of business; navigation, reporting
└─ SubCategory      Home Loan (LN-HM)          carries field definitions, document
   │                                           requirements, apply labels, lead routing
   ├─ Product       Home Loan – Salaried       the sellable offering: code, rates, fees
   └─ Product       Balance Transfer Home Loan
```

**`ProductType` is renamed and repurposed as `SubCategory`.** It already owns exactly what belongs at
that level; keeping both was the redundancy. A `Product` gets one FK to `SubCategory`; its category
is derived through the parent, so a product can never contradict its own taxonomy.

Naming discipline to enforce in validation messages and admin help text: a sub-category is a *type*
("Home Loan"), a product is an *offering* ("Home Loan – Salaried"). The mockups currently show a
product and a sub-category with near-identical names, which is what makes the layer look redundant.

### Visibility is derived, never propagated

Marking a category inactive must **not** write `Inactive` onto its children — that destroys their
individual state and cannot be undone on reactivation. A product is visible iff
`product.status` **and** `subCategory.status` **and** `category.status` are all active. Compute it in
one place (an `EffectiveStatus` projection reused by every query) and index for it.

### Attributes stay EAV, rules come from the shared engine

Keep `FieldDefinition` → `ProductFieldValue`, including the `NumericValue` decimal projection — that
is what makes attributes filterable and sortable, which a JSON blob cannot do. Move the definitions
from `ProductType` to `SubCategory`.

Add a `ValidationsJson` (jsonb) column to `FieldDefinition` and validate through
`FieldRuleEngine` from `Backend/Shared/OmniConnect.Validation`. **Copy the proven in-repo pattern**:
`Backend/LeadService/Models/Entities/LeadFieldConfig.cs:91-117` defines `LeadFieldRule` with
`ToEngineRule()` at :116, and `LeadFieldConfigService.cs:332,345` shows the
`FieldRuleEngine.Index(presets)` / `FirstFailure(...)` call pair. Presets come from AuthService via
the existing `ValidationPresetClient`. On the frontend, use `@omniconnect/ui/validation` so the
browser and server enforce identical rules, and add rows to
`packages/ui/src/validation/__fixtures__/rule-parity.json` for any new rule kind.

## What is deleted

| Area | Detail |
|---|---|
| **Promotions** | `Promotion` entity, `PromotionsController`, `PromotionService`, `PromotionsPage.tsx`, `usePromotionStore`, `promotionApi`, promotion drawers |
| **Applications** | `Application`, `ApplicationFieldValue`, `ApplicationDocument`, `ApplicationStatusHistory`, their controller/service, `ApplicationsPage.tsx`, `ApplyNowDrawer.tsx` (621 lines), `useApplicationStore`, file upload + `LocalFileStorageService` |
| **Reviews** | Dead already — `Review` entity and `ReviewsController` exist but there is no Reviews page, no `reviewApi`, no moderation UI. Removes `reviews:*` capabilities |
| **`SeedData.cs`** | All 614 lines. Replaced by a minimal bootstrap (below) |
| **All 8 existing migrations** | Replaced by one `InitialCreate` against the new schema |
| **LeadService `Products` table** | Entity, `HasData` seed, `MasterDataService` product methods, `GET /api/products`, `GET /api/products/full` |
| **Dead code found** | `RankingConfig` (unreferenced in the frontend), `ProductService.PrimaryNumeric:181-185`, `PagingQuery`, `DocumentUploadConstraints.AllowedContentTypesToExtension`, `clearProductsReadCache()`, `useHostNavigate()`, `validateRequestedAmount()`, `public/icons.svg`, `FixedPermissionProvider` outside tests |

Dropping Applications also removes `EmploymentType` and `DocumentDefinition`'s *upload* role —
but keep `DocumentDefinition` attached to `SubCategory`, because document requirements per product
type are exactly the reason the sub-category layer exists and the lead flow will need them.

**Blast radius:** ProductsService database only. AuthService, LeadService and Customer360 databases
are untouched except for the LeadService changes named in Phase 4.

### Bootstrap vs seed

No demo catalog. But `StatusValidation` derives the default status from the lowest-`SortOrder`
enabled `StatusConfig` row, so with an empty table nothing can be created. Ship a **bootstrap
migration** containing only reference data the system cannot function without: the `StatusConfig`
rows for Product / Category / SubCategory. Categories, sub-categories and products start empty and
are created through the UI.

## What is kept — do not rewrite

This machinery is contract-bound to AuthService and the host shell and is already correct:

- `Infrastructure/Security/*` — RS256 JWT validation, `RequiresCapabilityAttribute`,
  `RequiresFineCapabilityAttribute`, `FineCapabilityClient`, `InternalApiKeyFilter`
- `Infrastructure/Approvals/ProductsMutations.cs` and the maker-checker replay path
- `Services/CentralAuditForwarder.cs` and the audit dual-write
- `PermissionsController` — reflects over capability attributes to publish `GET /permissions`
- `AuthServiceClient` — the `X-Internal-Api-Key` pattern
- `StatusConfig` + `StatusValidation` — genuinely enforced configurable statuses
- Frontend: `src/services/httpClient.ts` (the `createRequestCache` axios adapter, 401-refresh-retry,
  `ApprovalPendingError` handling), `src/api/hostBridge.ts`, `src/permissions/*`, the
  `postcss-prefix-selector` CSS isolation in `postcss.config.cjs`

`ProductsCapabilityManifest.cs`, `ProductsNavigationManifest.cs` and `ProductsMutations.cs` each hold
a hand-maintained list that **must** be regenerated to match the new endpoint set —
`ProductsService.Tests/PermissionTests.cs` asserts agreement in both directions and will fail if they
drift.

## Phase 1 — Schema and catalog APIs

New/changed entities in `src/ProductMarketplace.Domain/Entities/`:

- `Category` — drop `ParentCategoryId` self-reference (the hierarchy is now explicit);
  keep `Name`, `Code`, `Slug`, `Description`, `IconKey`, `Status`, `DisplayOrder`
- `SubCategory` (from `ProductType`) — `CategoryId` FK, `Name`, `Code` (unique per category),
  `Description`, `IconKey`, `Status`, `DisplayOrder`, `ApplyButtonLabel`, `AmountFieldLabel`
- `Product` — `SubCategoryId` FK (category derived), `Name`, `Code` (unique), `ShortDescription`,
  `Description`, `IconKey`, `Status`, `DisplayOrder`, `RatingAverage`, `ViewCount`
- `FieldDefinition` — re-parent to `SubCategoryId`; add `ValidationsJson` (jsonb)
- `ProductFieldValue`, `ProductBenefit`, `ProductEligibility`, `DocumentDefinition`
  (re-parented to `SubCategory`), `StatusConfig`, `AuditLog`, `SearchLog`, `ProductViewLog`

One `InitialCreate` migration plus the bootstrap migration. Indexes must cover the effective-status
query and the `(CategoryId, DisplayOrder)` / `(SubCategoryId, DisplayOrder)` orderings.

**Delete the 12 hardcoded status literals** that bypass `StatusValidation`: `ProductService.cs:94`,
`:171`, `:331`; `DashboardService.cs:41`, `:49-50`; `Mapping.cs:172`, `:233-234`;
`ApplicationService.cs:19-20` (removed with Applications). Replace with lookups resolved from
`StatusConfig` via a small cached resolver.

APIs — `api/categories`, `api/sub-categories`, `api/products`, `api/setup/*`, all approval-gated on
mutation exactly as today. Add cursor pagination alongside the existing page/size for large lists,
and ETag / `If-None-Match` on catalog reads.

## Phase 2 — Admin UI

Rebuild `Frontend/apps/products_and_marketplace_mf` to the four mockups. Sidebar becomes
Dashboard · Products · Categories · Sub-categories · Setup · Audit Logs — driven by
`ProductsNavigationManifest.cs`, not the frontend.

- **New `SubCategoriesPage`** with full CRUD (mockup 4) — the feature that does not exist today
- `CategoriesPage` — promote `CategoryManagementPanel.tsx` (469 lines, currently a page masquerading
  as a component, mounted from two places) into a real page
- `ProductsPage` — card grid per mockup 2; `cardFields` and `featureTags` already produce exactly the
  key/value rows and tag pills shown
- `SetupPage` — split the 870-line file into per-tab components; tabs become field definitions and
  document requirements **per sub-category**, plus statuses
- `DashboardPage` — counts must be live aggregates (the mockups disagree with each other: 5 vs 8
  categories, 14 vs 28 sub-categories)

**Remove every hardcoded value the audit found**, notably: `src/data/countries.ts` (151 countries,
dial codes, flags, phone-length rules — move to a backend reference endpoint), the two disagreeing
`ICONS` arrays (`CategoryFormDrawer.tsx:13`, `ProductTypeFormDrawer.tsx:11`), `StatusBadge.tsx:8-31`
fallback tone/label maps, `SetupPage.tsx:22` `STATUS_ENTITY_TYPES`, `fieldFormat.ts:8` and
`KpiCard.tsx:9` hardcoded `₹`, and `DonutChart.tsx:3` `PALETTE`. Colours come from
`theme.token(name)`, which the host bridge already exposes
(`apps/host/src/shared/federation/hostBridge.ts:51-54`) but this remote's local interface
(`src/api/hostBridge.ts:18-24`) does not even declare — add it.

Adopt `@omniconnect/ui` components in place of the local tables, filter bars, KPI cards and form
fields (currently only ~19 import sites, mostly `PageHeader`/`Pagination`/`Button`).

## Phase 3 — Dashboard and audit

Rebuild `DashboardPage` against the new taxonomy (mockup 1: 5 KPI tiles, products-by-category bar
chart, status donut, recently added, recent activity). Keep the existing audit trail, SignalR hub and
CSV export; update `CentralAuditForwarder.cs:57-84`, whose `CategoryFor` and `Describe` map entity
types to sidebar modules through hardcoded `if`/`switch` chains, to the new entity set.

## Phase 4 — Lead Management integration

Target flow: **pick Category → see its Products → pick a Product → lead form opens.**

**LeadService calls ProductsService server-side**, following the existing pattern
(`AuthServiceClient.cs:53`, `ValidationPresetClient.cs:64-66`): a new `ProductCatalogClient` sending
`X-Internal-Api-Key`, with `ProductsService:{BaseUrl,InternalApiKey}` config. `lead_mf` keeps calling
only LeadService. This avoids a CORS change, avoids publishing a second base URL through the host
bridge, and — decisively — avoids the capability problem: a lead user holds `remote.lead.*`, not
`products:View`, so a direct browser call would 403 for most users. It also gives one server-side
place to cache the catalog.

Changes:

- **Delete** LeadService's `Product` entity, its 7-row seed, and `MasterDataService`'s product methods
- `Lead` stores `CatalogProductId` (the ProductsService Guid) **plus a snapshot** of product name,
  code, sub-category and category captured at creation. A renamed or retired product must never
  corrupt a historical lead — this is why the snapshot is not optional
- `LeadFieldConfig` re-keys from `ProductId` to `CatalogSubCategoryId`, so every home-loan product
  inherits the Home Loan field set instead of being configured one at a time
- `CreateLeadDto.Product` (a name string, `LeadDtos.cs:33-34`) becomes `CatalogProductId`
- **Delete the literal product-name branches**: `LeadService.cs:161,170,536,546`,
  `LeadFieldConfigService.cs:210,215`, `EditLeadDrawer.tsx:73,76`, and the `DEFAULT_PRODUCTS`
  fallback at `LeadFilterPopover.tsx:49-53`. Which product-specific section renders is already
  config-driven in `LeadFormContainer.tsx:38-39` — extend that, do not re-add name checks
- **Replace `ProductSelector.tsx`** (one flat dropdown) with a two-step category → product picker.
  `LeadFormContainer.tsx:49` already gates the whole form on a product being chosen, so that is the
  insertion point

New endpoints on LeadService, proxying the catalog: `GET /api/catalog/categories`,
`GET /api/catalog/categories/{id}/products`. Both return only *effectively active* entries.

## Enterprise concerns

- **Caching.** The catalog is read-heavy and rarely written. Use `IPlatformCache` /
  `IDistributedLock` (`AuthService/Infrastructure/Caching`, `.../Locking`) — in-memory by default,
  Redis when `ConnectionStrings:Redis` is set. Per `CLAUDE.md`, do **not** take a direct
  `IMemoryCache` dependency in an app service; that is what made a two-replica deploy serve stale
  sidebars. Invalidate on write with a version-stamped key.
- **Pagination.** Cursor-based for catalog lists; `OFFSET` degrades badly at depth.
- **Query shape.** The effective-status projection must be index-backed, not computed per row in
  memory.
- **Connection pooling** is already tuned for Neon (`DependencyInjection.cs:62-79`) — keep it.
- **Frontend.** Every GET continues through `createRequestCache`; stores read with
  `useXStore(useShallow(...))` — the remote currently has zero whole-store subscriptions and must
  keep it that way.

## Non-negotiable constraints (from `CLAUDE.md`)

- Import `@omniconnect/ui/tokens.css` **before** local CSS — a missing tokens import renders the
  remote unstyled and neither typecheck nor build catches it. Read `docs/SHARED-UI-REFACTOR-STATUS.md`
  before touching CSS.
- New test files are `.test.ts(x)` — `.spec.*` is not collected.
- `userEvent.type` parses `{` and `[` as key syntax; use `fireEvent.change` for literal strings.
- Backend tests: xUnit, hand-written fakes (no mocking library), `EntityFrameworkCore.InMemory`,
  full-sentence method names, class-level `<summary>` explaining *why* the surface is worth testing.
- `react`/`react-dom`/`zustand` stay MF shared singletons; the container name `products_mf` stays
  globally unique; capabilities stay declared through `GET /permissions`.

## Verification

Per phase, then end-to-end:

```bash
cd Backend/ProductsService.Tests && dotnet test -o ./bin/TestRunTemp
cd Backend/LeadService.Tests   && dotnet test -o ./bin/TestRunTemp
```

Keep `-o` **inside** the repo tree — `LicensingRemovedTests` walks up looking for a sibling `Backend`
folder and fails on a false negative otherwise. Stop any running service first, or the build fails
copying a locked `apphost.exe`.

```bash
cd Frontend && pnpm install && pnpm -C apps/products_and_marketplace_mf test && pnpm -C apps/lead_mf test
```

`PermissionTests.cs` and `LeadService.Tests/PermissionDiscoveryTests.cs` are the canaries — they fail
if capability attributes, the manifests and the navigation rows drift apart.

End-to-end: `node scripts/dev-backends.mjs`, then `pnpm dev:all`. Sign in, then confirm:
create a category → create a sub-category under it → create a product under that → mark the category
**inactive** and verify the product disappears from both the catalog and the lead product picker →
mark it active again and verify the product returns **with its own status intact** → create a lead by
choosing category, then product, and confirm the lead stores the product reference *and* the snapshot.

New tests to add (none exist today for these): `CreateLeadAsync` end-to-end including product
resolution, the effective-status cascade, sub-category CRUD, and the category → product picker
component.

## Risks

- **`LeadFieldConfig` re-keying is the highest-risk step.** Its FK to LeadService's `Products.Id`
  currently drives the entire lead form's visibility, required and format behaviour
  (`LeadFormContainer.tsx:38-39,49`). Do Phase 4 only once Phases 1–3 are green.
- **Cross-service coupling.** LeadService gains a hard dependency on ProductsService for lead
  creation. Decide the failure mode deliberately: `AuthServiceClient` fails *hard* (503) for approval
  gating, while `FineCapabilityClient` fails *closed*. Catalog reads should degrade to a cached copy
  rather than block lead creation outright.
- **Scope.** This is a ~27k-LOC rewrite across two backends and two frontends. It will not fit in one
  session; the phases exist so each one can land and ship independently.
