# Phase 1 execution map — ProductsService

> **Historical.** Phase 1 is complete; this describes the service as it was *before* the rebuild. For the
> current state read [PROGRESS.md](PROGRESS.md).

Companion to [BRIEF.md](BRIEF.md). That file holds the *plan and reasoning*; this one holds the
**current-state facts** a fresh session would otherwise spend an hour re-discovering. Read BRIEF.md
first for the "why", then this for the "where".

Everything below was verified against the code on 2026-09-29. Line numbers are from that state — if
a file has moved on, trust the file and fix this note.

**Scope of Phase 1:** `Backend/ProductsService` only. No frontend, no LeadService.

---

## Orient in five minutes

Read these six files, in this order, and you will understand the service:

| File | Why |
|---|---|
| `src/ProductMarketplace.Domain/Entities/` (19 files) | The whole domain. All GUID PKs assigned client-side |
| `src/ProductMarketplace.Infrastructure/Data/Configurations/EntityConfigurations.cs` | **Every** EF configuration is in this one file — indexes, delete behaviours |
| `src/ProductMarketplace.Application/Interfaces/IServices.cs` | **Every** service interface in one file |
| `Controllers/ProductsController.cs` | The endpoint + capability + approval-gating pattern to copy |
| `Infrastructure/Security/RequiresCapabilityAttribute.cs` | How `perms` claims are matched (`:112-118`) and how admins bypass (`:103-106`) |
| `Controllers/PermissionsController.cs` | `GET /permissions` reflects over capability attributes to publish the capability set |

Layout note: the API project sits at the service root (`ProductMarketplace.Api.csproj`, with
`<DefaultItemExcludes>src\**`), and the three class libraries live under `src/`. The test project is
a sibling: `Backend/ProductsService.Tests`. Port 5266. No `UsePathBase` — routes are plain `/api/...`.

---

## Current domain model

19 entities, **one** enum (`FieldDataType` in `Enums/Enums.cs`: Text, Number, Currency, Percentage,
Boolean, Date, Dropdown, MultiSelect).

**The two facts that drive the whole redesign:**

1. **`Category` is already self-referencing.** `ParentCategoryId` → `ParentCategory` / `SubCategories`.
   Sub-categories exist in the schema today and are never surfaced in the UI. `Product` has a single
   FK to `Category` — pointing at either a top-level or a child node. There is **no**
   `Product → SubCategory` column.
2. **`ProductType` is the de-facto sub-category.** It owns `FieldDefinitions`, `DocumentDefinitions`,
   `ApplyButtonLabel`, `AmountFieldLabel`, `ShortLabel`. This is what Phase 1 renames to
   `SubCategory`.

**Product attributes are EAV, not JSONB.** `ProductType` → `FieldDefinition` (the schema) →
`ProductFieldValue` (the value, plus a `NumericValue` `decimal(18,4)` shadow used for sorting and
filtering). Keep this. The only "JSON" in the service is `FieldDefinition.OptionsJson`, and it is a
plain `text` column parsed in C# — **there is no jsonb anywhere yet**, so the `ValidationsJson`
column BRIEF.md calls for is the first one.

Unique indexes today: `Categories.Slug`, `ProductTypes.Code`, `Products.Code`,
`Applications.ApplicationNumber`, `SearchLogs.Term`, `(FieldDefinitions.ProductTypeId, Key)`,
`(ProductFieldValues.ProductId, FieldDefinitionId)`, `(StatusConfigs.EntityType, Value)`.

Delete behaviours: `Restrict` on `Category.Parent`, `Product.Category`, `Product.ProductType`,
`Application.Product`; `SetNull` on `ApplicationFieldValue.FieldDefinition`; `Cascade` elsewhere.

---

## Delete list — exact paths

### Whole domains

| Domain | Files |
|---|---|
| **Promotions** | `Domain/Entities/Promotion.cs`, `Controllers/PromotionsController.cs`, `Infrastructure/Services/PromotionService.cs`, `Application/Dtos/PromotionDtos.cs`, `IPromotionService` in `Interfaces/IServices.cs` |
| **Applications** | `Domain/Entities/{Application,ApplicationFieldValue,ApplicationDocument,ApplicationStatusHistory}.cs`, `Controllers/ApplicationsController.cs`, `Infrastructure/Services/ApplicationService.cs`, `Application/Dtos/ApplicationDtos.cs`, `Application/Common/DocumentUploadConstraints.cs`, `Infrastructure/Services/LocalFileStorageService.cs`, `ConcatenatedStream.cs`, `IApplicationService` + `IFileStorageService` |
| **Reviews** | `Domain/Entities/Review.cs`, `Controllers/ReviewsController.cs`, `Infrastructure/Services/ReviewService.cs`, `Application/Dtos/ReviewDtos.cs`, `IReviewService` |
| **EmploymentTypes** | Existed only for the Apply flow: `Domain/Entities/EmploymentType.cs`, `Controllers/EmploymentTypesController.cs`, `Infrastructure/Services/EmploymentTypeService.cs`, `Application/Dtos/EmploymentTypeDtos.cs` |
| **RankingConfig** | `Domain/Entities/RankingConfig.cs`, `Controllers/RankingConfigsController.cs`, `Infrastructure/Services/RankingConfigService.cs`, `Application/Dtos/RankingConfigDtos.cs` — the frontend never references it |

> `Application` is aliased `DomainApplication` throughout to avoid colliding with the
> `ProductMarketplace.Application` namespace. Removing it removes that alias — expect compile noise
> in `AppDbContext.cs` and `Mapping.cs`.

### Seed and migrations

- `src/ProductMarketplace.Infrastructure/Data/Seed/SeedData.cs` — **all 614 lines**
- All 8 migrations in `src/ProductMarketplace.Infrastructure/Data/Migrations/`:
  `20260824101104_InitialCreate`, `20260824172242_AddAuditLogAndProductViews`,
  `20260825032724_AddDocumentDefinitions`, `20260825041843_AddStatusConfig`,
  `20260826045419_AddEmploymentTypesAndRankingConfigAndProductTypeLabels`,
  `20260902060000_NormalizeCategoryDisplayOrder`, `20260907032506_AddIsReadOnlyToFieldDefinition`,
  `20260915030936_PlatformIntegration`
- `Program.cs:152-163` — the seed invocation. **Note `SeedStatusConfigsAsync` at `:163` runs
  unconditionally in every environment**, including production. The bootstrap migration replaces it.

### Confirmed-dead code (zero call sites, verified by repo-wide grep including tests)

- `Infrastructure/Services/ProductService.cs:181-185` — `PrimaryNumeric`, private static, unused
- `Application/Common/PagedResult.cs:12-28` — `PagingQuery` class; every query DTO re-implements its
  own clamping
- `Application/Common/DocumentUploadConstraints.cs:7-13` — `AllowedContentTypesToExtension`,
  superseded by magic-byte `DetectContentType`

---

## Build list

### `Category`

Drop the `ParentCategoryId` self-reference — the hierarchy becomes explicit through `SubCategory`.
Keep `Name`, `Code`, `Slug`, `Description`, `IconKey`, `Status`, `DisplayOrder`, timestamps.

`Slugify` at `Infrastructure/Services/CategoryService.cs:296` is
`.ToLowerInvariant().Replace(" ","-").Replace("&","and")` — no diacritic or punctuation handling.
Improve it or drop `Slug` entirely; nothing in the frontend surfaces it.

### `SubCategory` (from `ProductType`)

`CategoryId` FK, `Name`, `Code` (unique per category), `Description`, `IconKey`, `Status`,
`DisplayOrder`, `ApplyButtonLabel`, `AmountFieldLabel`. Mockup 4 shows the code scheme: `LN-HM`,
`LN-CR`, `LN-PS` under Loans; `CCB`, `CCR`, `CCP` under Credit Cards.

`ApplyButtonLabel`/`AmountFieldLabel` default to `"Apply Now"`/`"Requested Amount"` and are
**re-defaulted in five more places** — `Domain/Entities/ProductType.cs:9-10`,
`Infrastructure/Services/Mapping.cs:191-192`, `ProductTypeService.cs:49-50,71-72`,
`Application/Dtos/FieldDtos.cs:72-73,84-85`, `ProductDtos.cs:19-20`. Collapse to one source.

### `Product`

One FK to `SubCategoryId`; category derived through the parent, so a product cannot contradict its
own taxonomy. Keep `Name`, `Code` (unique), `ShortDescription`, `Description`, `IconKey`, `Status`,
`RatingAverage`, `ViewCount`; add `DisplayOrder`.

### `FieldDefinition`

Re-parent `ProductTypeId` → `SubCategoryId`. Add `ValidationsJson` (**jsonb** — the service's first).
Keep the display flags, which genuinely drive rendering: `DisplayOnCard`, `DisplayOnDetails`,
`IsPrimaryMetric`, `IsSecondaryMetric`, `IsReadOnly`, `Filterable`, `Sortable`. Drop
`DisplayInApplication` and `VisibleToCustomer` — both were for the deleted Apply flow.

**Pattern to copy for validation** (do not invent a second one):
`Backend/LeadService/Models/Entities/LeadFieldConfig.cs:91-117` defines `LeadFieldRule` with
`ToEngineRule()` at `:116`; `LeadService/Services/LeadFieldConfigService.cs:332,345` shows the
`FieldRuleEngine.Index(presets)` / `FieldRuleEngine.FirstFailure(...)` call pair. Presets come from
AuthService — `LeadService/Infrastructure/ValidationPresetClient.cs:64-66`.

### Effective status

A product is visible iff its own status **and** its sub-category's **and** its category's are all
active. Derived at query time, index-backed. **Never** write `Inactive` onto children — that
destroys their own state and makes reactivation lossy. Put it in one reusable projection, because
every list, count and dashboard aggregate needs it.

### Bootstrap migration

`StatusValidation.EnsureValidOrDefaultAsync` derives the default status from the **lowest-`SortOrder`
enabled `StatusConfig` row**, so an empty table means nothing can be created at all. The bootstrap
migration ships `StatusConfig` rows for `Product` / `Category` / `SubCategory` and nothing else.

The old 25-row status catalogue at `SeedData.cs:549-577` is the reference for shape — colours are
free-text `"neutral"`, `"warning"`, `"success"`, `"danger"`, `"info"` with no validation. Note the
comment at `SeedData.cs:533` admits these were copied from the frontend's `StatusBadge.tsx`.

`StatusConfigService.cs:13-17` has a `ValidEntityTypes` HashSet — Product, Category, Review,
Promotion, Application. Update it to Product / Category / SubCategory.

---

## The hardcoded status literals to remove

These bypass `StatusConfig` entirely and are the concrete violations of "nothing hardcoded":

| File:line | Literal |
|---|---|
| `Infrastructure/Services/ProductService.cs:94` | `x.Status == "Active"` (promotion boost) |
| `ProductService.cs:171` | `x.Status == "Active"` (active-promotion include) |
| `ProductService.cs:331` | `.Where(p => p.Status == "Active")` (top performers) |
| `DashboardService.cs:41` | `string[] approvedStatuses = ["Approved", "Completed"]` |
| `DashboardService.cs:49-50` | `p.Status == "Active"` |
| `Mapping.cs:172` | `p.Status == "Active"` (`IsPromotionActive`) |
| `Mapping.cs:233` | `r.Status == "Published"` |
| `Mapping.cs:234` | `x.Status == "Active" \|\| x.Status == "Scheduled"` |
| `ReviewService.cs:62` | new review `Status = "Pending"` — never goes through `StatusValidation` |
| `ReviewService.cs:108` | `r.Status == "Published"` |
| `ApplicationService.cs:19-20` | `DraftStatus`/`SubmittedStatus` consts |
| `ApplicationService.cs:313` | `a.Status != DraftStatus` |

Most vanish with Promotions/Applications/Reviews. What survives needs a small cached resolver over
`StatusConfig`.

Also: `Mapping.cs:184,232`, `DashboardService.cs:140,161`, `ProductService.cs:325` call `.ToString()`
on properties that are **already `string`** — leftovers from when statuses were C# enums. Clean up.

---

## The three hand-maintained lists that break tests

`ProductsService.Tests/PermissionTests.cs` asserts these agree with the capability attributes **in
both directions**. Change endpoints without regenerating them and the build goes red:

| File | Holds |
|---|---|
| `Infrastructure/Security/ProductsCapabilityManifest.cs:26-77` | 8 modules, 26 capabilities, with labels and descriptions |
| `Infrastructure/Security/ProductsNavigationManifest.cs:22-53` | The entire sidebar — 8 rows, icon keys, sort orders. Target per the mockups: Dashboard · Products · Categories · Sub-categories · Setup · Audit Logs |
| `Infrastructure/Approvals/ProductsMutations.cs:32-67` | 30 mutation descriptors, mirrored by a **55-case switch at `:107-162`**. Adding an approvable operation means editing both |

Current capability set (format `remote.products.{module}:{Capability}`):
`dashboard:View` · `products:View|Create|Edit|Delete|Apply|Export` · `categories:View|Create|Edit|Delete`
· `promotions:*` · `reviews:*` · `applications:View|Manage` · `setup:View|Manage` · `audit:View|Export`.
After Phase 1 it should be roughly: `dashboard:View` · `products:View|Create|Edit|Delete|Export` ·
`categories:*` · `sub-categories:*` · `setup:View|Manage` · `audit:View|Export`.

`products:Export` and `audit:Export` are type `"Export"` — enforced by `RequiresFineCapabilityAttribute`
via a network call to AuthService, **not** carried in the token.

---

## Keep — contract-bound, do not rewrite

`Infrastructure/Security/*` (RS256 validation, capability attributes, `FineCapabilityClient`,
`InternalApiKeyFilter`) · `Infrastructure/Approvals/*` and the replay path ·
`Services/CentralAuditForwarder.cs` · `Controllers/PermissionsController.cs` ·
`Infrastructure/AuthServiceClient.cs` · `StatusConfig` + `StatusValidation` ·
`Infrastructure/DependencyInjection.cs:62-79` (Neon-tuned pooling: `MinPoolSize`, `KeepAlive=30`,
`EnableRetryOnFailure(5, 10s)`).

Two behaviours worth knowing before you touch `Program.cs`:

- A missing connection string does **not** throw — `DependencyInjection.cs:29-42` substitutes
  `"Host=unconfigured;…"` so `/health` and `/permissions` stay up. Deliberate.
- CORS **fails closed** (`Program.cs:70-81`): origins come only from `Cors:AllowedOrigins`, and an
  unconfigured deployment serves no browser origin at all.

`CentralAuditForwarder.cs:57-72` (`CategoryFor`) and `:75-84` (`Describe`) map action prefixes and
entity types to sidebar modules through hardcoded `if`/`switch` chains — these **do** need updating
to the new entity set.

---

## Tests

`Backend/ProductsService.Tests` — 7 files, 1,148 lines, ~52 tests. xunit 2.9.2 +
`EntityFrameworkCore.InMemory` 10.0.4. **Not referenced by `Backend/OmniConnect.slnx`.**

| File | Covers | Phase 1 impact |
|---|---|---|
| `TestSupport.cs` | In-memory context factory, fake AuthService handler, claims builders | Reuse |
| `PermissionTests.cs` | 11 tests — permission semantics, `/permissions` ↔ manifest agreement both ways | **Will fail until manifests are regenerated** |
| `EndpointSecurityTests.cs` | 5 — every action has `[Authorize]` and demands a capability | Should stay green |
| `ApprovalAndAuditTests.cs` | 16 — actor attribution, gating, **every mutation has a replay handler** | **Will fail until `ProductsMutations` matches** |
| `StatusCountTests.cs` | Application + promotion status counts | Mostly deleted with those domains |
| `SummaryQueryTests.cs` | Dashboard summary, product card shape | Rewrite against the new taxonomy |
| `ScaleAndUploadTests.cs` | Page-size clamping, magic-byte upload detection | Upload half deleted; keep the paging half |

**Never covered, and worth adding in Phase 1:** `CategoryService` (slug, reorder/renumber invariant,
delete guards), `ProductTypeService` field CRUD, `DocumentDefinitionService`, `StatusValidation`,
`Mapping`, any migration. Plus the new one that matters most: **the effective-status cascade** —
inactive category hides its products, reactivating restores each child's own status unchanged.

---

## Commands

```bash
cd Backend/ProductsService.Tests && dotnet test -o ./bin/TestRunTemp
```

Two gotchas, both from `CLAUDE.md`:

- Keep `-o` **inside** the repo tree. `LicensingRemovedTests` walks up from the test binary looking
  for a sibling `Backend` folder; point `-o` at `/tmp` and it fails on a false negative.
- If the service is running in another terminal, `dotnet build`/`test` fails copying a locked
  `apphost.exe`. Stop it, or use `-o` as above.

```bash
cd Backend/ProductsService && dotnet ef migrations add InitialCreate   # needs its own build first
node scripts/dev-backends.mjs auth products                            # just these two
```

Test conventions to match: `[Fact]`/`[Theory]`, **no mocking library** — hand-written fakes
(`StubHandler : HttpMessageHandler`), full-sentence method names
(`An_inactive_category_hides_its_products_without_changing_their_own_status`), arrange/act/assert
separated by blank lines, and a class-level `<summary>`/`<remarks>` explaining *why* the surface is
worth testing.
