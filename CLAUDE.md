# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

OmniConnect is an enterprise micro-frontend platform: a central **host** React app that authenticated
users land in, which dynamically loads independently-deployed **remote** micro-frontends at runtime
from a database-backed registry — no remote is ever hard-coded into the host's build. Four .NET 10
backend services, one PostgreSQL database each; a pnpm-workspace frontend (host + three remotes + a
shared component library). Contract for a new remote (JWT, CORS, per-service keys, audit, approvals,
shared UI): [docs/ADDING-A-REMOTE-APP.md](docs/ADDING-A-REMOTE-APP.md). Full architecture: [README.md](README.md). Local setup runbook (DB
provisioning, `.env` files, RS256 keys, first sign-in): [SETUP.md](SETUP.md) — do not re-derive that
from scratch, follow it.

```
Frontend/apps/host              shell — login, sidebar, settings, approvals, audit logs (5173)
Frontend/apps/lead_mf            Lead Management remote (5002)
Frontend/apps/customer360_mf     Customer 360 remote (5003)
Frontend/apps/products_and_marketplace_mf  Products & Marketplace remote, app key "products" (5004)
Frontend/packages/ui             @omniconnect/ui — shared component library, workspace:* dep, NOT a Module Federation share
                                   (subpaths: /validation field-format engine, /validation-editor rule editor)
Backend/AuthService               users/roles/permissions/JWT/maker-checker/audit hub, remote-app
                                   registry, capability discovery, health probing, sidebar (5155)
Backend/LeadService                 leads CRUD; path base /api/lead-service (5046)
Backend/Customer360Service           customer profile/CRM proxy; no path base (5059)
Backend/ProductsService              products marketplace; clean architecture (src/ProductMarketplace.*) (5266)
Backend/Shared/OmniConnect.Validation  the server field-format engine, referenced by AuthService and LeadService
```

Each service has its **own** internal API key (`Internal__Services__<Service>__ApiKey` in AuthService's
`.env`); AuthService identifies the caller by it. Page views are audited through
`POST /api/audit-logs/page-views`, which accepts only a route and resolves it against the caller's
navigation tree — see `docs/AUDIT-EVENTS.md`.

There was a fourth service, `ModuleRegistry` (port 5200), holding the remote-app registry in its own
database and pushing capabilities into AuthService over HTTP. It has been **removed** and its whole
job absorbed into AuthService — AuthDb is now the single source of truth for remote apps. If you find
a reference to it, it is stale prose, not a live dependency.

## Commands

### Backend (.NET 10, run from `Backend/<Service>/`)
```bash
dotnet run                                    # apply EF migrations automatically, then serve
dotnet build                                  # see "locked apphost.exe" gotcha below
dotnet ef migrations add <Name>               # from the service folder; needs its own build first
```

### Backend tests (xUnit, one `<Service>.Tests` project per service)
```bash
dotnet test                                                    # from Backend/<Service>.Tests/
dotnet test --filter "FullyQualifiedName~SomeTestClass"        # a single test class
dotnet test --filter "FullyQualifiedName~SomeTestClass.SomeMethod"  # a single test
```
**Gotcha 1 — locked `apphost.exe`:** if the service is running locally (`dotnet run` in another
terminal), `dotnet build`/`dotnet test` on that same project fails copying `apphost.exe`/`<Service>.dll`
into its own `bin/`. Either stop the running instance first, or redirect output with `-o` so the build
never touches the locked folder: `dotnet test -o ./bin/TestRunTemp`.
**Gotcha 2 — `-o` outside the repo breaks `LicensingRemovedTests`:** that test's `RepoRoot()` walks up
from the test binary's own directory looking for a sibling `Backend` folder. Point `-o` at a path
*inside* the OmniConnect tree (e.g. `Backend/AuthService.Tests/bin/TestRunTemp`), not `/tmp` or anywhere
outside it, or that one test fails on a false negative. Delete the temp output dir after.

Test conventions: xUnit `[Fact]`/`[Theory]`, no mocking library — hand-written fakes/stubs
(`StubHandler : HttpMessageHandler`, `FakeHubCallerContext`) and `Microsoft.EntityFrameworkCore.InMemory`
for anything touching `AuthDbContext`. Pattern for a DB-backed test class:
```csharp
public class FooTests : IDisposable
{
    private readonly AuthDbContext db;
    public FooTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"foo-{Guid.NewGuid()}").Options;
        db = new AuthDbContext(options);
    }
    public void Dispose() { db.Dispose(); GC.SuppressFinalize(this); }
}
```
Method names are full sentences (`A_required_field_left_empty_fails_with_a_message_naming_the_field`),
arrange/act/assert separated by blank lines, and a class-level `<summary>`/`<remarks>` explaining *why*
the surface is worth testing — match this, don't invent a new style.

### Running the whole platform, and load testing
`node scripts/dev-backends.mjs` starts all four services (`auth lead c360 products` to pick a subset);
in the desktop Browser pane use the `backends-all` + `remotes-all` + `frontend-dev` launch entries (the
pane allows five dev servers, which is why the backends and remotes are grouped).
Load testing — procedure and last results in `docs/LOAD-TEST-RESULTS.md`:
`Backend/LoadTest/OmniConnect.LoadTest` (`seed|count|cleanup --run <id>`, every row tagged with the run id,
cleanup re-counts to prove 0 remain — the Neon databases are shared), `scripts/loadtest/http-load.mjs`
(concurrency ramp) and `scripts/loadtest/browser-bench.js` (signed-in latency from a host tab).

### Frontend (pnpm workspace, run from `Frontend/`)
```bash
pnpm install
pnpm dev:host / pnpm dev:lead / pnpm dev:customer360 / pnpm dev:all
pnpm -C apps/host build   # or packages/ui, apps/lead_mf, apps/customer360_mf
```

### Frontend tests (vitest, per-package — `apps/host`, `apps/lead_mf`, `apps/customer360_mf`, `packages/ui`)
```bash
pnpm test          # vitest run — from the specific package directory
pnpm test:watch    # vitest, watch mode
```
Run a single file/test with vitest's own filters, e.g. from the package dir:
`pnpm exec vitest run src/path/to/Foo.test.tsx -t "test name substring"`.

Config lives in each package's own `vitest.config.ts` (deliberately separate from `vite.config.ts`,
which wires up Module Federation and needs a live remote server — tests must not depend on one).
`include: ['src/**/*.test.{ts,tsx}']` — **`.spec.*` is not picked up**, name new test files `.test.ts(x)`.
Co-locate a test next to the file it covers, same directory, same basename.

Conventions: `describe`/`it`/`expect` from `vitest`; a doc-comment after the imports explaining *why*
the file is worth testing, not just what; Zustand stores driven directly via `useXStore.setState({...})`
before render, no mocking library, `vi.mock('../api/xApi')` only for actual network-calling modules;
`@testing-library/react` + `@testing-library/user-event` for components, queries by role/accessible
name over test-ids. **`userEvent.type` parses `{` and `[` as key-sequence syntax** — for a literal
string containing either (a regex pattern being typed into an input, say), use
`fireEvent.change(el, { target: { value } })` instead. A native `<select>`/`<input>` with no
`<label htmlFor>` association has no accessible name even if a sibling `<span>` looks like a label —
query it by `getAllByRole('combobox')[n]` (documented index) rather than `{ name }` in that case.

## Architecture

### Auth, permissions, and Maker-Checker (read `docs/AUTH-ARCHITECTURE.md` before touching any of this)
AuthService issues RS256-signed JWTs; every other service verifies with the public key only, never
issues its own. The permission catalog is **dynamic per feature**, not a fixed enum: each host feature
and each registered remote declares its own capability set (`PermissionFeatureCapability`), and a
remote's set is learned by `RemoteAppAppService` fetching that remote's own `GET /permissions` on
registration/resync (`RemoteCapabilityDiscoveryClient`, a v1→v4 ladder) and handing it to
`PermissionCatalogAppService`. **Null vs empty is load-bearing there**: a null capability/module list
means "the remote could not be read" and the stored set is left alone, while an empty list is a real
answer and deactivates it — collapse the two and one unreachable remote revokes every permission it
grants. `[RequirePermission(featureKey, capability)]`
(host) / `[RequiresCapability(...)]` (remotes) read the JWT's `perms` claim — administrators bypass
per-capability checks entirely. AuthService is also the **maker-checker hub**: a mutation gated for a
module goes through `ApprovalGatingService` instead of applying immediately, is stored as one flat
snapshot DTO shared by both the old and new side of the diff (see `UserSnapshotDto`), and replay
reconstructs the real request type from that snapshot (`ApprovalAppService.ReplayAsync`) — when adding
a field to a gated request/response pair, update the snapshot DTO, both places that build it, and the
replay reconstruction together, or an approved mutation silently drops the new field on replay.

### The admin-configurable user-schema system (all under `host.settings.users`, no separate permission)
Three independently admin-editable catalogs, each a single JSONB-backed row (one entity, `GetAsync`
falls back to a sane default when the row doesn't exist yet, `UpdateAsync` does a full-list replace and
bumps `Version`) with a matching frontend page under **Settings → Manage Fields / Manage Formats**:
- **`UserFieldSchema`** (`Backend/AuthService/.../UserFieldSchemaAppService.cs`) — which fields the
  Create/Edit User form collects. `name`/`email`/`phoneNumber` are permanently reserved **core** fields
  (real `User` columns, can't be removed, but their validation rules ARE admin-editable); anything else
  is a fully admin-defined **custom** field whose value lives in `User.ExtraAttributes` (jsonb).
  **Role and Status are never part of this schema** — they're access-control concerns with their own
  dedicated, hardcoded UI, deliberately excluded so a schema edit can never weaken RBAC.
- **`ValidationPresetCatalog`** ("Manage Formats") — admin-defined reusable validation rules
  (`regex` / `lengthRange` / `numericRange` / `textPattern`) a field's rule can reference by key,
  layered alongside the fixed, code-defined preset catalog
  (`Backend/Shared/OmniConnect.Validation/FieldPresets.cs` ↔ `packages/ui/src/validation/fieldPresets.ts` —
  **keep these two in sync**; `rule-parity.json` below catches a mismatch).
- **`SalutationCatalog`** — the Mr./Ms./Dr./... list offered on Create/Edit User and shown on a
  profile. Same "fixed dropdown, admin-editable value list" shape as Role, not a `UserFieldSchema`
  field.
- **`FieldSectionCatalog`** (Manage Fields → **Sections** tab) — the headings that group fields on the
  Create/Edit User form and the user detail page. A field's `Section` is a section **key**, never its
  label, so renaming a section can't orphan fields; `personal-details` is the undeletable default
  (where an unresolvable field lands). Field `Order` is **per section**, renumbered 1..n by the server
  (`UserFieldSchemaAppService.Arrange`, mirrored by `utils/sections.ts` on the client — keep the two in
  step). Reads are forgiving (a legacy label, a blank, or a deleted section all resolve to a real
  section); saves are strict (an unknown section is refused). Deleting a section that still holds
  fields must name a destination in the same request (`ReassignFieldsTo`) so the delete and the move
  commit together. `UserFormLayer` renders purely from this catalog — nothing about section names or
  order is hardcoded there any more.

### Password policy (its own page and permission — **not** part of the user-schema system)
`Settings → Manage Password Policy`, gated by `host.settings.password-policy` (View/Edit), deliberately
separate from `host.settings.users`. One JSONB row (`PasswordPolicyCatalog`): global expiry days
(`0` = never), complexity rules, and reminder settings (email/in-app + lead days). Per-role expiry days
live in their own table, `PasswordPolicyRoleExpiries`, keyed by `RoleId` with a real foreign key to
`Roles` (cascade on delete), so the link is visible in the database rather than hidden in the JSON. A
role's value *replaces* the global one; no row = inherit; `0` is not allowed per role. A save replaces
the role rows in the same save as the catalog's version bump.
`PasswordPolicyOptions` (appsettings) is only the **seed**: enforced until an admin first saves, the DB
row after that. Expiry is enforced at **login and at token refresh** (`AuthAppService`), by setting the
same `MustChangePassword` flag a temporary password uses — so `MustChangePasswordFilter` and the
frontend `RequirePasswordChange` gate cover both, told apart by `passwordExpiry.isExpired` on the user
DTO. SSO accounts and un-accepted invites never expire. `PasswordExpiryReminderService` (under
`IDistributedLock`) emails one warning per threshold per password; the in-app banner is driven by the
server-resolved `passwordExpiry.showReminder`. The rollout migration starts the expiry clock at
deployment for existing accounts so switching this on doesn't expire everyone created >N days ago.

`Backend/Shared/OmniConnect.Validation` (`FieldRuleEngine`, used by AuthService's `UserSchemaValidator` and by
LeadService for lead fields) and `schemaValidation.ts` (`packages/ui`) are two implementations of the
*same* rule engine — a request that skips the browser must be held to identical rules as one that
didn't. Both run the shared table `packages/ui/src/validation/__fixtures__/rule-parity.json`
(`ValidationParityTests.cs` / `ruleParity.test.ts`); add a row whenever either engine changes. An unrecognised preset id **fails open** everywhere in this
system (never blocks every submission on a field just because a preset was renamed/deleted out from
under it) — preserve that when adding a new preset kind.

### Module Federation contract for a remote app
See `docs/ADDING-A-REMOTE-APP.md`. A remote: publishes `mf-manifest.json`, exposes `./App`, uses a
globally-unique MF container name, never imports the host's global CSS (imports
`@omniconnect/ui/tokens.css` before its own `index.css` instead), treats `react`/`react-dom` as shared
singletons, reads auth state from `window.__omniconnectHost__` (`getAccessToken()`,
`hasCapability(featureKey, capability)`, `getUser()`) instead of running its own login, and declares
its capability set dynamically via `GET /permissions`.

### CRM proxying (Customer360Service)
`CrmProxyService.cs` forwards `v1/indprofile`/`v1/corpprofile` etc. verbatim (status code and body) to
a **real external CRM** at `CrmApi__BaseUrl`. It is not a mock and not a local database — if search
starts returning 503s with a raw SQL-shaped `detail` message, that is almost certainly the external
CRM's own database, not a bug in this repo; verify with a direct `curl` against that base URL (obtain a
token via `POST {baseUrl}token` with `client_id`/`client_secret`/`grant_type=client_credentials`) before
assuming the fault is here.

### `@omniconnect/ui`
Consumed by all three frontend apps as a pnpm `workspace:*` dependency — deliberately **not** a Module
Federation `exposes` and not an MF shared singleton, so the host keeps zero build-time remotes and every
remote stays independently buildable. **Remote data loading:** each remote's HTTP layer (lead
`api/apiClient.ts` `fetchWithAuth`, products `services/httpClient.ts` axios adapter, customer360
`services/api.ts` `request`) routes every GET through `createRequestCache` from `@omniconnect/ui` —
identical overlapping reads share one request, successes are reused briefly (reference data longer),
any write clears the cache, and keys include the signed-in user id. Customer profile lookups in
customer360 are de-duplicated but never reused (the server audits each lookup). Read stores with a
selector (`useXStore(useShallow((s) => ({ … })))` or `useXStore((s) => s.x)`), never `useXStore()` —
a whole-store subscription re-renders on every store write. Read `docs/SHARED-UI-REFACTOR-STATUS.md` before touching any CSS
in this repo; it documents the traps that typecheck and build cannot catch (e.g. a remote rendering
unstyled because it's missing the `tokens.css` import).

### Remote-app registration (`Backend/AuthService/Application/Services/RemoteAppAppService.cs`)
Setup → Applications writes a `RemoteApp` row keyed on the `PermissionFeature` it belongs to — one
table, primary key = foreign key, so "a feature with no registration" is unrepresentable rather than
merely unlikely. **`DisplayName` and `SidebarOrder` live on the feature, not on `RemoteApp`**; keeping
a second copy is what produced the old "a display-order edit must ALSO be pushed for the app it
displaced" bug class. The sidebar is served by `GET /api/navigation` alone; `/api/remote-apps/health`
is a separate feed because health is rewritten on a probe interval while the tree is cached.

### Scaling past one instance
`IPlatformCache` and `IDistributedLock` (`Infrastructure/Caching`, `Infrastructure/Locking`) back the
navigation catalog, the fine-grained capability sets and the health-probe leader election. Both have
an in-memory implementation, which is the **no-configuration default and correct on one instance**.
Set `ConnectionStrings:Redis` and the Redis pair is registered instead, along with a SignalR
backplane. Do not reintroduce a direct `IMemoryCache` dependency in an app service — that is what made
a two-replica deploy serve stale sidebars.

## Known stale docs
`docs/DEPLOYMENT.md` and `docs/PERFORMANCE-AND-INFRA.md` carry banners marking which
parts predate the SQL Server→Postgres migration, and both still describe the retired ModuleRegistry
service. Don't treat either as current without checking against the actual code first.
