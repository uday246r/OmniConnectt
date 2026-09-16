# Adding a New Remote App

How to put a new micro-frontend and its backend on OmniConnect so that it signs people in with the
platform's token, enforces the permissions the Role editor grants, records everything in the central
audit trail, goes through maker-checker approval, and looks like the rest of the product.

The host is never rebuilt to gain an app. Everything below ends with an administrator registering it
in **Setup → Applications**.

**Copy a working pair, not this page.** The references, all current:

| | Frontend | Backend |
|---|---|---|
| Closest analogue | `Frontend/apps/lead_mf` | `Backend/LeadService` |
| Clean-architecture service | `Frontend/apps/products_and_marketplace_mf` | `Backend/ProductsService` |
| Read-mostly, proxies an external system | `Frontend/apps/customer360_mf` | `Backend/Customer360Service` |

---

## The things that must be unique per app

| Thing | Where it lives | If it collides |
|---|---|---|
| App **key** (`lead`, `products`) | Setup → Applications, and the backend's `Self__AppKey` | Registration refuses it. Every permission is `remote.<key>.<module>:<Capability>`, so the backend's key must match. |
| Module Federation **container name** (`lead_mf`) | `vite.config.ts` → `remoteFederationConfig(name, …)` | Refused at registration (AuthService reads the built manifest). |
| **Port** | the app's `.env` → `VITE_PREVIEW_PORT`; the service's `launchSettings.json` | Startup failure, or a manifest on a port the registry does not know. |
| **CSS scope id** (`#lead-mf-scope`) | `postcss.config.cjs` → `SCOPE_ID`, and the root element in `App.tsx` | Styles leak between apps. |
| **Internal service key** | `Internal__Services__<ServiceName>__ApiKey` in AuthService's `.env` | Each service has its own; see *Service keys*. |

---

## 1. Frontend

Copy `Frontend/apps/lead_mf` to `Frontend/apps/<app>_mf`, then:

- **`package.json`** — a unique `name`; keep `@omniconnect/ui` and `@omniconnect/federation-config` as
  `workspace:*`. Keep the `test` / `build` scripts; `build` must type-check the app's real tsconfig.
- **`vite.config.ts`** — `federation(remoteFederationConfig('<app>_mf', './src/App.tsx', ['zustand']))`.
  List every shared package you actually import (`zustand`, `react-router-dom`, `@tanstack/react-query`).
  An unlisted one gets its own second copy — a second router with an empty context is the classic
  failure. Listing one you did not install fails the build.
- **`postcss.config.cjs`** — change `SCOPE_ID`; keep both plugins (selectors and `@keyframes` names).
- **`App.tsx`** — the root element carries only the scope id.
- **Styles** — import `@omniconnect/ui/tokens.css` before your own CSS, never the host's global CSS.
  Build screens from `@omniconnect/ui`: `Drawer`, `Modal`, `DataTable`, `Pagination`, `ColumnFilter`,
  `Select` / `Combobox` (every dropdown is type-to-search), `Badge`, `Button`. Read
  `docs/SHARED-UI-REFACTOR-STATUS.md` first.
- **Drawers** — one close control (the header X), no footer "Close" button, and no database ids,
  GUIDs, raw JSON or action keys shown to people. Show names and plain-language descriptions.
- **Identity** — never run a login. `src/api/hostBridge.ts` reads `window.__omniconnectHost__`:
  `getAccessToken()`, `ensureFreshAccessToken()`, `hasCapability(featureKey, capability)`, `getUser()`.
  Send `Authorization: Bearer <token>` on every call, refresh once on a 401, and send nothing that
  names the user (no `X-Actor-*` headers — the server reads the actor from the token).
- **Permissions in the UI** — ask the bridge with the same strings the backend enforces:
  `hasCapability('remote.<key>.<module>', 'Create')`. Never grant everything in a mock provider.
- **Approvals** — a gated change answers `202` with `{ approvalRequestId, checkerName, message }`.
  Treat it as "sent for approval": close the form, say who must approve it, and do not show "saved".
- **Exports** — download server-side CSVs with `downloadCsv` from `@omniconnect/ui`; never build CSV in
  the browser from the rows on screen.
- **Page views** — nothing to do. Every page change inside a remote is a host URL change, and the host
  records it (`usePageViewTracking`); the page name comes from your navigation manifest.
- **Field formats** — to validate against Settings → Manage Formats, use `validateFieldValue` from
  `@omniconnect/ui/validation` and `ValidationRulesEditor` from `@omniconnect/ui/validation-editor`.

Every remote default-exports a React component from `./src/App.tsx`; the host always loads `<key>/App`.

Add a launch entry in `.claude/launch.json` with `"runtimeArgs": ["-C", "Frontend", "--filter", "<app>-mf", "dev"]`.
`-C Frontend` is required — the workspace root is `Frontend/`.

---

## 2. Backend

Copy `Backend/LeadService` (or `ProductsService`). Build context for its Dockerfile is `Backend/`, so
`Directory.Build.props` and `Backend/Shared` are available.

### Configuration (`.env`, loaded from the service folder; document every key in `.env.example`)

```
Jwt__SigningKeyPublic=<the platform public key — same value every service uses>
Jwt__Issuer=omniconnect-auth-service
Jwt__Audience=omniconnect-host
AuthService__BaseUrl=http://localhost:5155
AuthService__InternalApiKey=<this service's own key>
Internal__ApiKey=<the same key — AuthService presents it when replaying an approval here>
Self__PublicBaseUrl=http://localhost:<port>
Self__AppKey=<app key>
Cors__AllowedOrigins__0=http://localhost:5173
Cors__AllowedOrigins__1=http://localhost:<frontend port>
```

Nothing has a hard-coded fallback: CORS with no origins configured allows none, and a missing key
refuses internal calls.

### Service keys

Each service has its own internal key. In **AuthService's** `.env`:

```
Internal__Services__<ServiceName>__ApiKey=<key>
Internal__Services__<ServiceName>__CallbackBaseUrl=http://localhost:<port>
```

AuthService identifies the calling service by its key — audit and system-log rows are stamped with
that service's name whatever the body claims — and refuses an approval callback URL outside that
service's `CallbackBaseUrl`, so a leaked key cannot redirect replays elsewhere. It replays an approved
change to the service with that same service's key.

### Authentication and authorization

- RS256 JWT bearer with `MapInboundClaims = false` and the public key only (copy from LeadService `Program.cs`).
- `[Authorize]` on every controller. `[RequiresCapability("<Module>", "<Capability>")]` on every action,
  reads included; `[RequiresAnyCapability("A:View", "B:Create")]` when several roles need the same read.
  Administrators (the `administrator` claim) bypass capability checks.
- `GET /permissions` reflects over those attributes (both kinds), so the Role editor offers exactly
  what is enforced. A manifest adds labels and non-API capabilities (Export, Widget). An endpoint with
  no attribute is ungated *and* invisible to the permission system — the reflection test in
  `ProductsService.Tests` fails the build on one.
- Fine-grained capabilities (exports, dashboard cards) use `[RequiresFineCapability]`.

### Audit

- Write every create, update, delete, export and security-relevant read to your local audit table
  **and** push it to AuthService (`POST internal/audit-logs`) with `X-Correlation-Id`.
- The actor comes from the token only. `Details` is one plain-language sentence a non-technical reader
  understands ("Updated lead 'Asha Rao': phone number changed").
- Add every new action key to `docs/AUDIT-EVENTS.md` in the same change.
- Unhandled exceptions: answer with a generic message and a reference id, and report the detail with
  `PushSystemLogAsync` (see `LeadService/Middleware/ExceptionMiddleware.cs`). Never return `ex.Message`
  from a 500.

### Maker-checker

Before applying a mutation, ask `GET internal/approvals/gated/remote.<key>.<module>`. If gated, submit it
(`POST internal/approvals/submit`, with `entityKey` for a create) and return `202`. Expose
`POST /internal/approvals/apply` behind the internal key; it must re-run the **same validated service
method** with `bypassApproval: true`, so a change approved later is checked against the rules in force
then. `ProductsService/Infrastructure/Approvals` shows a table-driven version.

### Scale

Page and cap every list server-side (100 rows), filter and sort in SQL, index the filter columns, use
a pooled `DbContext`, keep uploads behind a storage abstraction, and wrap startup migrations so an
unreachable database does not crash the process.

---

## 3. Register it

**Setup → Applications → Register App**:

| Field | Value |
|---|---|
| Key | the app key (lowercase, unique, equal to `Self__AppKey`) |
| Display name | shown in the sidebar and on audit rows |
| Manifest URL | `http://localhost:<frontend port>/mf-manifest.json` |
| Permissions source URL | `http://localhost:<backend port>/<path base>/permissions` |

Registration fetches the manifest and the permissions. Grant capabilities per role under **Roles →
Application Access**; assign checkers under **Checker Assignment**.

---

## 4. Verify

- The app appears in the sidebar for a role granted it, and not for one without it.
- An anonymous call to its API returns 401; a signed-in user without the capability gets 403.
- A change to a gated module appears in the Approval Center, and applies once approved.
- Its actions — and every page opened in it — appear in **Audit Logs** with the real person's name.
- Stopping its server shows an *Unavailable* badge within a probe interval; starting it recovers.
- Its tests, and `pnpm build`, pass.
