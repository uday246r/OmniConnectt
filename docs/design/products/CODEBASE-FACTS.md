# Codebase facts — products frontend (Phase 2) and the lead vertical (Phase 4)

Companion to [BRIEF.md](BRIEF.md) and [PHASE-1-EXECUTION.md](PHASE-1-EXECUTION.md). Verified against
the code on 2026-09-29. Line numbers are from that state — trust the file if it has moved on.

---

# Part 1 — `Frontend/apps/products_and_marketplace_mf` (Phase 2)

119 files, ~14,300 lines (≈10,450 TS/TSX + 3,840 CSS). 6 test files. Port 5004.

## Routing is not react-router

`src/App.tsx:40-59` is a **`switch` on a `page` string prop** supplied by the host. The host maps the
URL `/apps/<appKey>/<page>` → that prop in
`apps/host/src/pages/RemoteAppPage/RemoteAppPage.tsx:60,76-79`. Unknown page falls back to Dashboard.
The remote registers **no routes and no sidebar entries** — navigation is served entirely by the
backend tree. `src/navigation/HostNavigation.tsx` exports `useHostNavigate()` which **nothing calls**;
every "View" action opens a drawer instead.

| `page` | Component | Lines |
|---|---|---|
| `dashboard` (default) | `pages/DashboardPage.tsx` | 241 |
| `products` | `pages/ProductsPage.tsx` | 556 |
| `categories` | `pages/CategoriesPage.tsx` | 33 (thin wrapper) |
| `promotions` | `pages/PromotionsPage.tsx` | 303 — **delete** |
| `applications` | `pages/ApplicationsPage.tsx` | 201 — **delete** |
| `setup` | `pages/SetupPage.tsx` | 870 |
| `audit-logs` | `pages/AuditLogsPage.tsx` | 341 |

Every modal and side panel routes through `useDrawerStore` → `components/drawer/DrawerHost.tsx`, a
**19-case switch** on `DrawerType`, rendered once from `App.tsx:66` with an untyped
`payload: Record<string, unknown>` cast per case.

## Structural problems to fix while rebuilding

- `pages/SetupPage.tsx` — five page-sized components in one 870-line file: `ProductTypesSetup` (`:75`),
  `CategoryManagementPanel` (reused, `:66`), `DocumentsSetup` (`:346`), `StatusesSetup` (`:498`),
  `EmploymentTypesSetup` (`:659`)
- `components/category/CategoryManagementPanel.tsx` (469) — a full page masquerading as a component,
  mounted from **two** places (`CategoriesPage` and the Setup tab). Promote it to a real page
- `components/product/ApplyNowDrawer.tsx` (621) — 4-step wizard, dynamic fields, upload and validation
  in one function. **Deleted with Applications**
- `DashboardPage.css` (507) + `ProductsPage.css` (461) + `global.css` (735) are 45% of all CSS

## The hardcoding inventory

**`src/data/countries.ts` (154 lines) is the worst offender.** 151 hardcoded country rows
(`:10-151`) — name, iso2, dialCode, flag emoji, **and `phoneLength`, which drives validation** — plus
`DEFAULT_COUNTRY = COUNTRIES[0]` pinned to India (`:154`). No `/countries` call exists anywhere.
Consumers: `components/common/CountrySelectDropdown.tsx:2,18,24,27`, `common/PhoneInput.tsx:1,22`,
`product/ApplyNowDrawer.tsx:15,147,208`, `utils/validation.ts:1`.

**Option lists compiled in:**

| File:line | What |
|---|---|
| `components/category/CategoryFormDrawer.tsx:13` | `ICONS` array (10 keys) |
| `components/setup/ProductTypeFormDrawer.tsx:11` | near-duplicate `ICONS` — **disagrees** (`"loan"`/`"deposit"` singular vs the other file's plural) |
| `components/setup/FieldDefinitionFormDrawer.tsx:12` | `DATA_TYPES` (8) |
| `components/setup/StatusConfigFormDrawer.tsx:11-17` | `TONES`, with colour names in the labels |
| `pages/SetupPage.tsx:22` | `STATUS_ENTITY_TYPES` |
| `pages/SetupPage.tsx:490-496` | `ENTITY_TYPE_LABELS` |
| `pages/ProductsPage.tsx:22-28` | `SORT_TABS` — 5 of 6 `SortOption`s; `"most-applied"` is unreachable |
| `pages/DashboardPage.tsx:18-22` | `TREND_OPTIONS` |
| `utils/fileValidation.ts:1-2,14-16` | `ACCEPT_ATTR`, 5 MB cap, MIME/extension lists |

Page-size dropdowns are hardcoded separately on **four** pages (`ProductsPage.tsx:331-335`,
`AuditLogsPage.tsx:224-228`, `PromotionsPage.tsx:142-146`, `ApplicationsPage.tsx:101-105`).

**Status→presentation maps keyed by literal name** — `common/StatusBadge.tsx:8-25` (`FALLBACK_TONE`,
16 statuses) and `:27-31` (`FALLBACK_LABEL`); `common/StatusCountCards.tsx:7-13,15-21`;
`product/ProductCard.tsx:7-14`; `application/ApplicationDetailsDrawer.tsx:18-44` switches on 9
literal statuses.

**Magic status strings driving behaviour:** `ProductsPage.tsx:151,161,469` (`"Active"`/`"Inactive"`),
`:462`; `ProductCard.tsx:42,104`; `CategoryManagementPanel.tsx:434,445` and `:170`;
`ProductFormDrawer.tsx:34` and `PromotionFormDrawer.tsx:40` default `"Draft"`;
`CategoryFormDrawer.tsx:29` defaults `"Active"`.

**Currency and colour:** `utils/fieldFormat.ts:8` returns `` `₹${value}${suffix}` `` for *every*
Currency field; `common/KpiCard.tsx:9` same. `charts/DonutChart.tsx:3` `PALETTE` of 8 hex values;
inline `color: "#2563eb"` at `SetupPage.tsx:413,572,791` and `CategoryManagementPanel.tsx:326`.

> The host bridge **already exposes `theme.token(name)`**
> (`apps/host/src/shared/federation/hostBridge.ts:51-54`) for exactly this — but this remote's local
> interface (`src/api/hostBridge.ts:18-24`) doesn't even declare it, so it can't be used. Add it.

**No i18n layer** — every title, table header, empty state and toast is an inline English literal.

## What to keep

`src/services/httpClient.ts` (157 lines) is well built — keep it:

- Axios instance with `defaults.adapter` replaced (`:26-68`). GET keys are
  `${userId ?? 'anonymous'} GET ${uri}` — **per-user**, so a re-sign-in can't read the previous
  user's data. Non-GET delegates to the network then `readCache.clear()` in a `finally`
- `createRequestCache({ ttlMs: 30_000 })` from `@omniconnect/ui`; reference data matching
  `/(categories|product-types|document-definitions|employment-types|status-configs)(\?|$)/` gets
  5 min (`:27-28`) — **update that regex for the new route names**
- Each caller gets a `structuredClone` of `response.data` (`:67`); per-caller abort via
  `Promise.race` (`:56-65`) so one caller aborting can't cancel the others
- Auth (`:108-116`): `getAccessToken()` → `window.__omniconnectHost__`. 401 retries **once** via
  `ensureFreshAccessToken()` (`:130-146`), then gives up
- A `202` with `approvalRequestId` becomes a rejected `ApprovalPendingError`, closes the drawer and
  fires a toast from the interceptor (`:70-127`). Every page's catch starts
  `if (isApprovalPending(err)) return;`
- `clearProductsReadCache()` (`:32`) is exported and **never called** — dead

**Stores are already correct.** 11 Zustand stores, plain `create<T>()`, no middleware. Every
multi-field subscription uses `useXStore(useShallow(...))`; **zero whole-store subscriptions**. Keep
it that way. (The `useShallow` object literals are written on single ~700-char lines, e.g.
`ProductsPage.tsx:58` — reformat for readability, don't change semantics.)

**CSS isolation is not CSS Modules.** Zero `*.module.css`. 18 global `.css` files using a `pm-*`
vocabulary (290 distinct class names), isolated at build time by `postcss.config.cjs`:
`postcss-prefix-selector` rewrites every selector to `:where(#products-mf-scope) <selector>`, plus a
plugin namespacing `@keyframes`. `App.tsx:64` renders the matching `<div id="products-mf-scope">`.
Token order is **correct** — `App.tsx:17-18` imports `@omniconnect/ui/tokens.css` before
`./styles/global.css`. There is no `index.css`; `global.css` plays that role.

**Module Federation:** `vite.config.ts` uses `remoteFederationConfig('products_mf', './src/App.tsx',
['zustand'])` from `Frontend/packages/federation-config/index.js:91-101` — `react`, `react-dom`,
`zustand` shared singletons, `cssCodeSplit: false`. `npm run dev` is
`vite build && concurrently "vite build --watch" "vite preview"` — **no HMR**, federation needs a real
build.

**Bridge type mismatch to fix:** `src/api/hostBridge.ts:9-16` declares `HostBridgeUser` with
`roleName` and `permissions[]`, but the host's `getUser()` actually returns only
`{ id, name, email, isAdministrator }` (`apps/host/src/shared/federation/hostBridge.ts:32`).

## Dead in the frontend

`clearProductsReadCache()`, `useHostNavigate()`, `useStatusConfigStore.isEnabled()`,
`useEmploymentTypeStore.fetchActiveOnly()`, `validateRequestedAmount()` (`utils/validation.ts:54`),
`RankingConfig`/`RankingConfigUpdate` types (`types/domain.ts:121-137`), `public/icons.svg`.

**`README.md` in this app is wrong in almost every particular** — says port 5173, describes
`src/layouts/StandaloneShell.tsx` and `src/permissions/currentUser.ts` (neither exists), claims npm
when the workspace is pnpm. Rewrite or delete it.

**Half-built:** Reviews (type, status entity, permissions, Setup tab — but no page, no API client),
sub-categories (`subCategoryCount` rendered in 4 places, no type, no service, no CRUD).

---

# Part 2 — the lead vertical (Phase 4)

## The core mismatch

**LeadService owns a private `Products` table with no category concept**, unrelated to
ProductsService. The two `Product` entities share only a name string.

- Entity: `Backend/LeadService/Models/Entities/MasterEntities.cs:6-21` — only `Id`, `Code`, `Name`,
  `IsActive`
- Seeded with fixed GUIDs at `Backend/LeadService/Data/ApplicationDbContext.cs:91-102`: ASB
  Financing, Automobile Financing, Home Financing, Micro Finance, Personal Financing, Solar Panel
  Financing, Umrah/Hajj/Travel Financing
- `Lead.ProductId` is a **real FK** to it (`Models/Entities/LeadEntities.cs:37,40`)
- But `CreateLeadDto.Product` is a **name string** (`Models/Dtos/LeadDtos.cs:33-34`), deliberately the
  only field keeping a static `[Required]` — the comment at `:30-32` explains why: the field config
  is *keyed by* product, so "no product" cannot exist
- Resolution: `Services/LeadService.cs:84-85` — case-insensitive name lookup, throws
  `InvalidOperationException($"Product '{dto.Product}' is not recognized.")`

## `LeadFieldConfig` — the highest-risk piece

`Models/Entities/LeadFieldConfig.cs:18-88`, FK'd to `ProductId` at `:24-27`, unique index
`(ProductId, ApiField)` at `ApplicationDbContext.cs:73`. Holds `ApiField`, `DisplayLabel`, `Section`,
`DisplayOrder`, `Visible`, `Required`, `Editable`, `Sensitive`, `MaskingRule`, `ValidationsJson`
(jsonb, `:80`).

It is **config over a fixed catalog, not EAV**. `Services/LeadFieldConfigService.cs:194-242`
`BuildDefaultsFor` enumerates the fields: 12 common to every product, plus `propertyType`/
`propertyStatus` for Home Financing (`:210-214`) and `dateOfIncorporation`/`companyName`/`entityType`
for Micro Finance (`:215-220`).

This drives the **entire** create form's visibility, required and format behaviour
(`LeadFormContainer.tsx:38-39,49`). Re-keying it from `ProductId` to a catalog `SubCategoryId` is the
riskiest step in the whole plan — do it only once Phases 1–3 are green.

## Hardcoded product names to delete

| File:line | What |
|---|---|
| `Backend/LeadService/Services/LeadService.cs:161,170` | `if (dto.Product == "Home Financing")` / `"Micro Finance"` — decides which detail table is written |
| `LeadService.cs:536,546` | same pair in `UpdateLeadAsync` |
| `Services/LeadFieldConfigService.cs:210,215` | `if (product.Name == "Home Financing")` in `BuildDefaultsFor` |
| `Frontend/apps/lead_mf/src/components/lead/EditLeadDrawer.tsx:73,76` | same two literals, drive the edit diff table |
| `lead_mf/src/components/lead/LeadFilterPopover.tsx:49-53` | `DEFAULT_PRODUCTS` fallback array, used at `:236` |

> `LeadFormContainer.tsx:38-39` already does this the **right** way — it decides which section renders
> from `fieldConfig.some(f => f.apiField === 'propertyType' | 'dateOfIncorporation')`, not a name
> check. Extend that pattern; do not re-add name branching.

## The form to replace

- Full **page**, not a drawer: route `/apps/lead/create-lead`, declared in
  `Backend/LeadService/Infrastructure/Security/LeadNavigationManifest.cs:52`
- `pages/CreateLeadPage.tsx:15-30` → `components/lead/LeadFormContainer.tsx:19-93`
- `LeadFormContainer.tsx:44-46` is **Step 1: `<ProductSelector />`**, and `:49` gates the entire rest
  of the form on `formData.product`. **That is the insertion point** for the category → product flow
- `components/lead/ProductSelector.tsx` is **31 lines total** — one `SearchableDropdown` of names,
  no category step, no cards. Replace it wholesale
- `LeadFormContainer` accepts `mode?: 'page' | 'drawer'` but only page mode is ever used; the drawer
  branch and `useLeadStore`'s `isDrawerOpen`/`openDrawer`/`closeDrawer` (`:1036-1039`) are dead

## Cross-service call pattern to copy

LeadService → AuthService already does exactly what LeadService → ProductsService must do:

- `Infrastructure/AuthServiceClient.cs:42-68` — `IsGatedAsync`, sets
  `request.Headers.Add("X-Internal-Api-Key", _options.InternalApiKey)` at **`:53`**. Fails **hard**
  (throws `ApprovalServiceUnavailableException`) rather than swallowing
- `Infrastructure/ValidationPresetClient.cs:64-66` — same header
- `Infrastructure/Security/FineCapabilityClient.cs` — same header, fails **closed**
- Config: `appsettings.Development.json` → `"AuthService": { "BaseUrl": "http://localhost:5155",
  "InternalApiKey": "omniconnect-dev-internal-key" }`. Add a `ProductsService` block alongside it
- Inbound counterpart both services already have: `Infrastructure/Security/InternalApiKeyFilter.cs`
  (header name at `:25`) + `Controllers/InternalApprovalsController.cs`

**Why server-side and not a direct browser call:** a lead user's token carries `remote.lead.*`, not
`products:View` — a direct call from `lead_mf` to :5266 would 403 for most users. It would also need
ProductsService's CORS to admit `localhost:5002` (it **fails closed**, `Program.cs:70-81`) and a
second base URL published through the host bridge, which today exposes only
`apiBaseUrls.authService` (`apps/host/src/shared/federation/hostBridge.ts:34-36,90-92`).

> `lead_mf/src/api/hostBridge.ts:77` declares `getAuthServiceBaseUrl()` and **nothing calls it** —
> no remote currently calls a foreign service from the browser.

## `lead_mf` HTTP layer

`src/api/apiClient.ts` — `API_BASE_URL` at `:6` defaults to
`http://localhost:5046/api/lead-service` (path base set at `LeadService/Program.cs:214`), so calls
build as `${API_BASE_URL}/api/products`. `fetchWithAuth` (`:193-233`) mirrors the products
`httpClient`: cache key `${userId ?? 'anonymous'} GET ${url}` (`:209`), `readCache.clear()` on any
write (`:204`), `ResponseSnapshot` stored because a body reads once (`:181-186`), reference-data TTL
5 min via the regex at `:179`, `shouldCache: status 2xx` (`:224`).

**Read helpers swallow errors and return `[]`** — a failed product fetch looks like "no products".
Worth fixing when the catalog becomes a cross-service call.

## Lead tests

`Backend/LeadService.Tests` — 7 files, 78 facts. `PermissionDiscoveryTests.cs` (11) is the canary:
`Every_navigation_row_requires_a_capability_its_own_module_declares` (`:151`) and
`Navigation_route_segments_are_unique_across_the_app` (`:173`) fail if a nav row or capability is
added without declaring it properly. `LeadFormatValidationTests.cs` (17) is the FieldRuleEngine
suite.

`lead_mf` — 6 vitest files. **No test covers `ProductSelector`, `LeadFormContainer`,
`CreateLeadPage`, or `useLeadStore`'s `setProduct`/`submitLead`; and no backend test covers
`CreateLeadAsync` end-to-end or product resolution.** Add these in Phase 4.
