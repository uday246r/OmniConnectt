# OmniConnect

Enterprise micro-frontend platform. A central **host** application (React 19.2 + Vite + Module
Federation 2.0) that authenticated users land in, which dynamically loads independently-deployed
**remote** micro-frontend apps at runtime from a database-backed registry — no remote is ever
hard-coded into the host's build.

**New to this repo?** Start with [SETUP.md](SETUP.md) — the step-by-step runbook for cloning,
installing, provisioning your own PostgreSQL databases and getting everything running locally.

## Repo layout

```
OmniConnect/
├── Frontend/                pnpm workspace
│   ├── apps/host                shell (5173)
│   ├── apps/lead_mf             Lead Management remote (5002)
│   ├── apps/customer360_mf      Customer 360 remote (5003)
│   ├── packages/ui              @omniconnect/ui — shared component library
│   └── packages/federation-config
├── Backend/                 OmniConnect.slnx — three .NET 10 services, one PostgreSQL database each
└── docs/                    deployment, adding a remote app, performance, shared-UI handoff
```

## Services

| Service | Purpose | Default port |
| --- | --- | --- |
| `Frontend/apps/host` | Host shell: login, sidebar, topbar settings drawer, approvals, system audit logs, dynamic remote loading | 5173 |
| `Frontend/apps/lead_mf` | Lead Management remote micro-frontend | 5002 |
| `Frontend/apps/customer360_mf` | Customer 360 remote micro-frontend | 5003 |
| `Backend/AuthService` | Users, roles, dynamic permission catalog, JWT auth, maker-checker approvals, platform audit log, global search | 5155 |
| `Backend/LeadService` | Leads CRUD, lead field config, dashboard, audit; path base `/api/lead-service` | 5046 |
| `Backend/Customer360Service` | Customer profile, contacts, products, interactions, field config, audit; **no** path base | 5059 |

`Backend/EmployeeService/` is a leftover empty directory from an earlier iteration and is not part
of the solution.

## Prerequisites

- Node.js v24, pnpm 9+ (`corepack enable` picks up the version pinned in `Frontend/package.json`)
- .NET SDK 10
- **PostgreSQL 14+** — three databases (`omniconnect_auth`, `omniconnect_lead`,
  `omniconnect_customer360`), one per service. Local, Docker or a hosted instance all work.
  Every `ConnectionStrings:*` entry in every `appsettings.json` is deliberately **blank**; the value
  comes from each service's gitignored `.env` and nowhere else. **No secret-bearing connection string
  is ever committed** — see the Known limitations section for the history behind that rule.
- **Redis** — optional, and only for running AuthService on more than one instance. Leave
  `ConnectionStrings__Redis` blank and the service uses in-memory caching, an in-process lock and no
  SignalR backplane, which is correct for a single instance.

## First-time setup

```bash
cd Frontend && pnpm install
```

```bash
cd Backend && dotnet restore
```

Copy every `.env.example` next to its real `.env` and fill in real values (connection strings, JWT
keys, CORS origins, internal API key — each file documents its own keys). `.env` files are
git-ignored; only `.env.example` files are committed.

## Running everything

`.claude/launch.json` at the repo root has preview entries for the three frontends (`host`,
`lead-mf`, `customer360-mf`). To run manually:

```bash
dotnet run --project Backend/AuthService
```

```bash
dotnet run --project Backend/LeadService
```

```bash
dotnet run --project Backend/Customer360Service
```

```bash
cd Frontend && pnpm dev:host
```

```bash
cd Frontend && pnpm dev:lead
```

```bash
cd Frontend && pnpm dev:customer360
```

`pnpm dev:all` runs all three frontends in parallel. The remotes' dev servers publish
`mf-manifest.json` on their own ports, so the host can load them without a build step.

Each backend applies its own EF Core migrations automatically on startup once its connection string
is set (`db.Database.MigrateAsync()` in `Program.cs`) — you don't need `dotnet ef database update`
for normal use. It is still available if you want to apply migrations ahead of time:

```bash
dotnet ef database update --project Backend/AuthService
```

On first run against an empty AuthDb, AuthService seeds the built-in permission catalog, six starter
roles (Super Admin, Admin, Manager, Agent, Normal User, Read Only User) and one bootstrap Super
Admin account:

> `superadmin@omniconnect.com` / a random password printed once in the startup log

The password is generated per install and only its hash is stored, so **copy it out of the log before
you lose it**. The account is flagged `MustChangePassword` and the global `MustChangePasswordFilter`
holds it to the change-password endpoint until you replace it.

### Generating the RS256 key pair

Access tokens are signed RS256. Generate a key pair once and put both values in
`Backend/AuthService/.env`; put only the **public** key in the other two services' `.env` files —
they validate tokens locally and never issue or forge them:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private.pem
```

```bash
openssl rsa -pubout -in private.pem -out public.pem
```

Paste each PEM's contents as a single `.env` line with real newlines replaced by literal `\n`
sequences — every service unescapes that automatically (see `RsaKeyLoader`/`Program.cs`).

## Contract for future remote apps

See [docs/ADDING-A-REMOTE-APP.md](docs/ADDING-A-REMOTE-APP.md) for the full walkthrough. In short,
any remote registered under Setup > Applications must:

1. Build with `@module-federation/vite` (via `@omniconnect/federation-config`) and publish an
   `mf-manifest.json` — that single URL is all an admin needs to paste into Setup → Applications.
2. Expose its root component as `./App` — the host always calls `loadRemote("<key>/App")`.
3. Use a **globally unique Module Federation container name** (`lead_mf`, `customer360_mf`, …).
   AuthService reads it from the fetched manifest and rejects a collision at registration time, with
   a unique index behind that check. Note that the container name is not the same thing as the
   RemoteApp `Key`.
4. Never import the host's global CSS. Style with its own CSS Modules, and import
   `@omniconnect/ui/tokens.css` in `App.tsx` before `./index.css` so it is also styled standalone.
5. Treat `react` / `react-dom` as federation-shared singletons matching the host's versions.
6. Read auth state from `window.__omniconnectHost__` (installed at host boot — see
   `Frontend/apps/host/src/shared/federation/hostBridge.ts`) instead of running its own login:
   `getAccessToken()` / `ensureFreshAccessToken()` for API calls, `hasCapability(featureKey,
   capability)` for UI gating, `getUser()` for identity. A remote is loaded with zero React props,
   so this is a live global read, not a snapshot.
7. Declare its capability set dynamically: expose a `GET /permissions` endpoint returning
   `{ "capabilities": [{ "key", "displayName" }] }`, point the RemoteApp's `PermissionsSourceUrl` at
   it, and gate each mutating action with `[RequiresCapability("...")]` reading the JWT's `perms`
   claim (reference implementations:
   `Backend/LeadService/Infrastructure/Security/RequiresCapabilityAttribute.cs` and the matching one
   in `Customer360Service`). AuthService fetches that endpoint on save/resync and reconciles the
   result into its catalog — adding a capability there is enough for it to appear in the host's Role
   editor. A remote that cannot be reached keeps whatever it last declared; it is never read as
   "declares nothing".

## What's built

- **AuthService** — RS256 JWT login/refresh/logout/me with an httpOnly refresh cookie and an
  absolute session cap, optional Google SSO, optional SMTP set-password invites, Users CRUD, Roles
  CRUD with a Features×Capabilities permission matrix, per-user permission overrides, and the
  internal endpoints every other service syncs through. The permission catalog is dynamic per
  feature (`PermissionFeatureCapability`) rather than one fixed enum — each host feature and each
  registered remote declares its own capability set. AuthService is also the **maker-checker hub**
  (`ApprovalRequest`, `CheckerAssignment`, `ApprovalGatingService`) and the single sink for the
  platform audit log: host mutations write directly, other services write through an internal
  API-key-protected endpoint, so host and remote audits land in one table. Audit rows are written
  only by the backend performing the action, attributed from the verified token — there is no
  browser-writable audit endpoint. Sign-in and session events, authorization denials, every
  permission change (with an added/removed diff), refused approval decisions, admin configuration
  changes and every CSV export are recorded; the full catalogue is
  [docs/AUDIT-EVENTS.md](docs/AUDIT-EVENTS.md). Unhandled errors return safe, consistent
  `ProblemDetails` JSON.
- **Remote-app registry** (inside AuthService) — RemoteApps CRUD, Active/Maintenance/Disabled status
  with an admin-authored maintenance message, capability discovery from each remote's own
  `GET /permissions`, background reachability probing of each `ManifestUrl`, and the
  resync-permissions recovery endpoint. This was a separate `ModuleRegistry` service with its own
  database that pushed results into AuthService over HTTP; absorbing it made AuthDb the single source
  of truth and removed the window in which the two could disagree.
- **LeadService** — Leads CRUD, lead field configuration, dashboard aggregates and audit, behind
  `[RequiresCapability]` gating and maker-checker approval replay. Served under path base
  `/api/lead-service`.
- **Customer360Service** — customer profile, contacts, products and interactions (proxying an
  external CRM), field configuration and audit, with the same gating and approval-replay contract.
  Mounted at the root — **no** path base.
- **Host frontend** — the "OmniConnect" theme (`shared/styles/theme.css` plus `@omniconnect/ui`'s
  `tokens.css`), split-panel login, dynamic sidebar (Dashboard + registered apps + a System section),
  Module Federation runtime loader with zero build-time remotes, a topbar gear settings drawer
  surfacing exactly the Users / Roles / Applications screens the signed-in user can reach, Approval
  Center and My Requests, System → Audit Logs and System Logs (server-side filtering and paging,
  one shared date-range control and CSV export across every log screen in all three apps), global search, skeleton loading throughout, every
  route code-split, CSS Modules only (no Tailwind/CSS-in-JS), Zustand for auth, navigation and health state.
- **`@omniconnect/ui`** — the shared component library (`Frontend/packages/ui`), consumed by all three
  apps as a pnpm `workspace:*` dependency. **Deliberately not** a Module Federation `exposes` and not
  an MF shared singleton: the host keeps declaring zero build-time remotes and remotes stay
  independently buildable. See [docs/SHARED-UI-REFACTOR-STATUS.md](docs/SHARED-UI-REFACTOR-STATUS.md)
  — required reading before touching any CSS in this repo.
- **`lead_mf` / `customer360_mf`** — two real remotes built to the contract above. Neither is seeded
  as a remote app; an admin registers each by pasting its `mf-manifest.json` URL into
  Setup → Applications.

## Known limitations

- Service-to-service auth is a shared static API key (`Internal__ApiKey`), not mTLS or OAuth
  client-credentials — a documented v1 simplification.
- Several `appsettings.json` files previously shipped **live database connection strings and a real
  `Internal__ApiKey`, committed into the repo**. They have been blanked — every one of those values
  now comes from each service's `.env` — but they remain in git history. **Treat all of them as
  compromised and rotate them**: the four database passwords and the internal API key.
- There is no CI pipeline. (Tests do exist: 528 backend across three xUnit projects — AuthService
  424, LeadService 59, Customer360Service 45 — and 366 frontend across the host 152, `@omniconnect/ui`
  138, `lead_mf` 28 and `customer360_mf` 48.)
- Maker-Checker concurrency is tested with deterministic fault injection and model-level schema
  assertions, not against a live Postgres: the database itself enforcing the partial unique index and
  the `xmin` token, and genuine multi-instance behaviour (Redis cache, lock and SignalR backplane),
  are not exercised by the suite.
- Customer 360's masked-field reveal is not audited: the browser unmasks a value it already holds and
  no request reaches the server, so there is no backend event to record. Auditing it needs
  server-side masking plus a reveal endpoint.
- `docs/ADDING-A-REMOTE-APP.md` still describes the earlier `employee_mf` / `EmployeeService`
  topology. `docs/DEPLOYMENT.md` and `docs/PERFORMANCE-AND-INFRA.md` now carry banners marking which
  parts are stale.

## Docs

| Document | What it covers |
| --- | --- |
| [SETUP.md](SETUP.md) | Local runbook — install, databases, keys, `.env`, first sign-in |
| [docs/SHARED-UI-REFACTOR-STATUS.md](docs/SHARED-UI-REFACTOR-STATUS.md) | `@omniconnect/ui`, and the CSS traps that have already caused breakage |
| [docs/ADDING-A-REMOTE-APP.md](docs/ADDING-A-REMOTE-APP.md) | Standing up a new micro-frontend without colliding with an existing one |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production topology, DNS, cookies and CORS |
| [docs/PERFORMANCE-AND-INFRA.md](docs/PERFORMANCE-AND-INFRA.md) | Measured load-test baseline and the infrastructure work left |
