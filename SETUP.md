# OmniRemit — Setup Guide for New Collaborators

Follow this top-to-bottom to get all seven components running locally:

| Component | Port |
|---|---|
| AuthService | 5155 |
| ModuleRegistry | 5200 |
| LeadService | 5046 |
| Customer360Service | 5059 |
| host frontend | 5173 |
| lead_mf remote | 5002 |
| customer360_mf remote | 5003 |

For architecture and what's built, see [README.md](README.md) — this file is just the "get it
running" runbook.

You provision your **own** SQL Server databases and your **own** signing keys. Nothing here is shared
with anyone else on the team, and you never need anyone else's secrets to run the project.

## 1. Prerequisites

| Tool | Needed | Check |
|---|---|---|
| Node.js | v24+ | `node --version` |
| pnpm | 9+ | `pnpm --version` (see below if missing) |
| .NET SDK | 10 | `dotnet --version` |
| SQL Server | 2019+, LocalDB, or the Docker image | `sqlcmd -?` |
| Git | any recent | `git --version` |
| OpenSSL | any recent | `openssl version` |

- **pnpm**: if you don't have it, run `corepack enable` (ships with Node). The repo pins the exact
  version via `packageManager` in `Frontend/package.json`, so pnpm auto-installs the right version
  the first time you run a pnpm command in that folder.
- **OpenSSL**: on Windows, Git Bash (installed with Git for Windows) already includes it. On
  macOS/Linux it is normally preinstalled.
- **EF CLI** (optional — migrations apply automatically on startup):
  `dotnet tool install --global dotnet-ef`

## 2. Clone and install

```bash
git clone https://github.com/Ashok-2004/OmniRemit.git
```

```bash
cd OmniRemit/Frontend && pnpm install
```

```bash
cd ../Backend && dotnet restore
```

## 3. Provision your own four SQL Server databases

Each service owns its **own** database — never shared between services, and never shared between
collaborators. This is deliberate: it is what lets one service be migrated or redeployed without
taking another down.

Create four empty databases:

| Database | Used by | Connection string key |
|---|---|---|
| `omniremit_auth` | AuthService | `ConnectionStrings__AuthDb` |
| `omniremit_registry` | ModuleRegistry | `ConnectionStrings__RegistryDb` |
| `omniremit_lead` | LeadService | `ConnectionStrings__LeadDb` |
| `omniremit_customer360` | Customer360Service | `ConnectionStrings__Customer360Db` |

You do **not** need to create any tables — each service applies its own EF Core migrations on first
startup.

### Local SQL Server (Windows authentication)

```
Server=localhost;Database=omniremit_auth;Trusted_Connection=True;TrustServerCertificate=True;
```

### Local SQL Server or Docker (SQL authentication)

```
Server=localhost,1433;Database=omniremit_auth;User Id=sa;Password=<your-password>;TrustServerCertificate=True;
```

To run SQL Server in Docker:

```bash
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=<your-password>" -p 1433:1433 -d mcr.microsoft.com/mssql/server:2022-latest
```

### Azure SQL (what production uses)

```
Server=tcp:<your-server>.database.windows.net,1433;Initial Catalog=omniremit_auth;Persist Security Info=False;User ID=<user>;Password=<pass>;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
```

Repeat with the right `Database` / `Initial Catalog` name for each of the four.

> If a service starts with no connection string set it will **not** crash — it logs a warning and
> serves, but every database-backed endpoint fails until you configure it. That is intentional, so a
> misconfiguration is diagnosable rather than a startup crash loop.

## 4. Generate your own RS256 key pair

AuthService signs login tokens with a private key; ModuleRegistry, LeadService and
Customer360Service each verify them with the matching public key. Only AuthService ever holds the
private key. Generate your own pair — nobody else's key material should be reused:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private.pem
```

```bash
openssl rsa -pubout -in private.pem -out public.pem
```

Each `.env` needs the PEM contents on a **single line**, with real newlines replaced by the two
literal characters `\n`. A private key file like:

```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7...
-----END PRIVATE KEY-----
```

becomes one `.env` line:

```
Jwt__SigningKeyPrivate=-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7...\n-----END PRIVATE KEY-----\n
```

Do the same for `public.pem`. Once both are copied into your `.env` files (step 5), delete
`private.pem` and `public.pem` — don't leave loose copies around, and never commit them.

## 5. Configure your `.env` files

Copy each `.env.example` to `.env` in the same folder, then fill in the blanks. Two values must be
**identical everywhere they appear**:

- your **public key** — in all four backend `.env` files (AuthService also holds the private key)
- the **internal API key** — `Internal__ApiKey` in AuthService, and `AuthService__InternalApiKey`
  plus `Internal__ApiKey` in each of the other three. Generate one with `openssl rand -base64 32`
  and paste the same value into all of them.

> ⚠️ `Backend/LeadService/.env.example` currently has a real-looking internal API key and a public
> key **committed into the repo**. Do not reuse either — overwrite both with your own values, and
> treat the committed key as compromised anywhere it has been used.

### `Backend/AuthService/.env`

```bash
cp Backend/AuthService/.env.example Backend/AuthService/.env
```

Fill in:
- `ConnectionStrings__AuthDb` — your AuthService connection string (step 3)
- `Jwt__SigningKeyPrivate` / `Jwt__SigningKeyPublic` — both keys, single-line `\n`-escaped (step 4)
- `Internal__ApiKey` — the shared internal key
- `Security__TempPasswordKey` — 32 random bytes, base64: `openssl rand -base64 32`. Without it,
  approving a gated user creation is **refused** (fail closed) rather than silently losing the
  generated temporary password.

Everything else has a working local default — `Cors__AllowedOrigins__0` is already
`http://localhost:5173`.

### `Backend/ModuleRegistry/.env`

```bash
cp Backend/ModuleRegistry/.env.example Backend/ModuleRegistry/.env
```

Fill in `ConnectionStrings__RegistryDb`, `Jwt__SigningKeyPublic`, `AuthService__InternalApiKey` and
`Internal__ApiKey`. `AuthService__BaseUrl` and `Self__PublicBaseUrl` already default to the right
localhost ports.

### `Backend/LeadService/.env`

```bash
cp Backend/LeadService/.env.example Backend/LeadService/.env
```

Fill in `ConnectionStrings__LeadDb`, `Jwt__SigningKeyPublic` (**replace** the committed one),
`AuthService__InternalApiKey` (**replace** the committed one) and `Internal__ApiKey`.

`Self__PublicBaseUrl` already includes the `/api/lead-service` path base, which is required — that is
the URL AuthService calls back to replay an approved mutation.

`Self__LeadModuleKey` and `Self__FieldSettingsModuleKey` are **runtime facts you cannot know yet** —
they are the `PermissionFeature.Key` values AuthService creates when this app is registered in
Setup → Applications. Leave them blank for now and come back to them in step 8 if you want to
exercise maker-checker gating.

### `Backend/Customer360Service/.env`

```bash
cp Backend/Customer360Service/.env.example Backend/Customer360Service/.env
```

Fill in `ConnectionStrings__Customer360Db`, `Jwt__SigningKeyPublic`, `AuthService__InternalApiKey`
and `Internal__ApiKey`. `Self__FieldSettingsModuleKey` is the same kind of runtime value as
LeadService's — leave it blank initially.

`CrmApi__BaseUrl` / `CrmApi__ClientId` / `CrmApi__ClientSecret` point at the external CRM this
service proxies. Leave them blank unless you have real credentials; the rest of the service works
without them.

### `Frontend/apps/host/.env`

```bash
cp Frontend/apps/host/.env.example Frontend/apps/host/.env
```

No changes needed — `VITE_AUTH_SERVICE_URL` and `VITE_MODULE_REGISTRY_URL` already point at the
default backend ports. Both are **required**: the host throws at startup with a clear message rather
than letting a blank base URL produce confusing network errors later.

### `Frontend/apps/lead_mf/.env` and `Frontend/apps/customer360_mf/.env`

```bash
cp Frontend/apps/lead_mf/.env.example Frontend/apps/lead_mf/.env
```

```bash
cp Frontend/apps/customer360_mf/.env.example Frontend/apps/customer360_mf/.env
```

No changes needed. Note the asymmetry, which is not a typo: lead_mf's `VITE_API_BASE_URL` includes
the `/api/lead-service` path base, customer360_mf's does not — Customer360Service mounts its
controllers at the root.

## 6. Run everything

Each in its own terminal, from the repo root:

```bash
dotnet run --project Backend/AuthService
```

```bash
dotnet run --project Backend/ModuleRegistry
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

Or run all three frontends at once with `pnpm dev:all` from `Frontend/`.

The remotes' Vite **dev** servers publish `mf-manifest.json` directly, so no build step is needed
locally. `pnpm --filter lead-mf build` then `preview` serves the production output on the same port
if you want to test what actually gets deployed.

Each backend **applies its database migrations automatically on first startup** — no `dotnet ef`
commands required. Watch the AuthService terminal for a one-time line like:

```
info: AuthService[0]
      Seeded default Super Admin account. Email: superadmin@omniconnect.com | Password: Admin@123456
```

## 7. Verify it's working

Open **http://localhost:5173** and sign in:

- **Email:** `superadmin@omniconnect.com`
- **Password:** `Admin@123456`

> ⚠️ This is a fixed credential hard-coded in `AuthDbSeeder.cs`, and the seeded account is **not**
> flagged `MustChangePassword` — nothing will prompt you. Change it yourself right after your first
> sign-in, and never let it survive into a deployed environment.

You should land on the dashboard showing real counts — 1 user, 6 roles. (Cards whose data is
genuinely unavailable are omitted rather than showing a fabricated zero, so don't read a missing card
as a count of nothing.) That confirms the frontend, both platform backends and your databases are all
talking to each other.

## 8. Register the two remote apps

A remote's server being up is not enough — it appears only once an administrator registers it in
**Setup → Applications → + Register App** (the gear icon in the topbar).

### Lead Management

| Field | Value |
|---|---|
| Key | `lead` |
| Display name | `Lead Management` |
| Manifest URL | `http://localhost:5002/mf-manifest.json` |
| Permissions source URL | `http://localhost:5046/api/lead-service/permissions` |

### Customer 360

| Field | Value |
|---|---|
| Key | `customer360` |
| Display name | `Customer 360` |
| Manifest URL | `http://localhost:5003/mf-manifest.json` |
| Permissions source URL | `http://localhost:5059/permissions` |

The **Permissions source URL** is what makes the permission system dynamic: ModuleRegistry fetches it
on save (and on **Resync permissions**, from the same page) to learn that service's current
capabilities and pushes them into AuthService's catalog automatically — no capability list is
hand-typed anywhere. After registering, the app appears in the sidebar, and its capabilities appear
under a "Remote apps" group in every role's permission editor. As Super Admin you already have
everything (administrators bypass per-capability checks).

ModuleRegistry also background-probes each `ManifestUrl`, so an app whose server is down is shown as
unreachable in Setup → Applications rather than failing only when a user clicks it.

### Filling in the module keys (only if you want maker-checker gating)

Once an app is registered, AuthService has created its `PermissionFeature.Key` values. Read them from
**Setup → Applications**, or from `GET /api/checker-assignments/modules` on AuthService, then put
them into `Self__LeadModuleKey` / `Self__FieldSettingsModuleKey` in the relevant `.env` and restart
that service.

## 9. Optional — Google SSO

Google Sign-In ships fully wired but **inert by default**. While unconfigured the login page hides
the SSO block entirely — no button, no "OR" divider, and Google's script is never requested — so the
form reads as a deliberate password-only login rather than a broken alternative.

Configuration is **backend-only**: the browser reads the Client ID from `GET /api/auth/sso-config` at
runtime, so enabling SSO needs no frontend rebuild and rotating the ID needs no redeploy.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth
   2.0 Client ID** of type "Web application".
2. Add your frontend origin under **Authorized JavaScript origins** — `http://localhost:5173` for
   local work (no path, no trailing slash). No redirect URI is needed: Google Identity Services
   returns the credential to the page.
3. Set **both** of these in `Backend/AuthService/.env`:
   - `Google__ClientId` — the generated Client ID. Public by design, but it still belongs in `.env`.
   - `Google__AllowedDomains` — comma-separated email domains permitted to sign in, e.g.
     `acme.com,acme.co.uk`. **Both must be set**: an empty domain list means nobody can sign in,
     which is the safe default rather than an oversight.
4. Restart AuthService. The button appears on the next page load — no frontend rebuild.
5. Create a user with **Authentication Method: Google SSO** in Setup → Users. SSO never auto-creates
   an account: an administrator still provisions the user row first, just with no password. That
   user's email domain must be on the allowlist.

Three rejections are reported distinctly so a failure is diagnosable: SSO not configured (503),
domain not on the allowlist (401), and no provisioned account for that Google identity (401).

> `VITE_GOOGLE_CLIENT_ID` in `Frontend/apps/host/.env` is a leftover and is no longer what enables
> SSO. The Client ID is served from AuthService so one frontend build runs in every environment.

## 10. Optional — email set-password invites

When an administrator creates a user, the new account can be emailed a **single-use, time-limited
link** to choose their own password. This is preferred over emailing a temporary password: a link
expires, dies on first use, and never leaves a working credential sitting in a mailbox.

Like SSO, this is **inert until configured** — without SMTP settings no mail is attempted, account
creation succeeds exactly as before, and the maker collects the temporary password from My Requests
as usual. That fallback stays available even once email is on, for users who cannot receive mail.

Set these in `Backend/AuthService/.env`:

- `Smtp__Host` — e.g. `smtp.gmail.com`, `smtp.office365.com`, or a corporate relay
- `Smtp__Port` — `587` for STARTTLS (typical) or `465` for implicit TLS
- `Smtp__Username` / `Smtp__Password` — mailbox credentials. For Google Workspace this must be an
  **App Password**, not the account password. Leave both blank for an internal relay that accepts
  mail from trusted hosts without authentication.
- `Smtp__FromAddress` — sender address; defaults to `Smtp__Username` if omitted
- `Smtp__FromName` — display name, defaults to `OmniConnect`
- `Smtp__AppBaseUrl` — **required.** The public URL of the frontend, e.g. `http://localhost:5173`.
  Invite links are built from it. It cannot be inferred from the request: the `Host` header is
  attacker-controllable, and an invite link is exactly the kind of thing that must never be built
  from one.
- `Smtp__InviteValidHours` — link lifetime, default `48`

All of `Smtp__Host`, a resolvable sender, and `Smtp__AppBaseUrl` must be present before any mail is
sent — a half-configured deployment stays silent rather than promising an email that cannot arrive.

Connections always use TLS. Port 465 connects with implicit TLS; anything else requires a successful
STARTTLS upgrade and fails rather than silently falling back to an unencrypted session.

**These are secrets** — keep them in the gitignored `.env`, never in `appsettings.json`.

## Troubleshooting

- **A backend exits immediately** ("address already in use") — something else holds that port. Check
  nothing else uses 5155 / 5200 / 5046 / 5059 / 5173 / 5002 / 5003.
- **The frontend can't bind to 5173** — same thing, one instance at a time. The dev server is
  configured to fail loudly rather than silently switch ports, because a silent switch would break
  login with a confusing CORS error instead.
- **Login fails with a CORS error** — `Cors__AllowedOrigins__0` in each backend `.env` must exactly
  match the URL the frontend actually runs at (`http://localhost:5173` by default; no trailing slash,
  exact scheme/host/port). Development also reads these from `appsettings.Development.json`.
- **A backend logs "ConnectionStrings__... is not set"** — it starts anyway, but every DB-backed
  endpoint fails. Fill in that service's connection string and restart.
- **A backend can't reach SQL Server** ("certificate chain … not trusted") — add
  `TrustServerCertificate=True` for a local or Docker instance. Do not use it against Azure SQL; use
  `Encrypt=True;TrustServerCertificate=False` there.
- **The session drops moments after a successful login** — the refresh cookie isn't coming back. On
  localhost `Auth__SameSite=Lax` is correct. Only set `None` when the frontend and API are genuinely
  cross-site, and note that `None` also requires a Secure cookie, which is enforced at startup.
- **A registered app never appears in the sidebar** — its capabilities didn't come back from
  `Permissions source URL`. Confirm the service is running and that the permissions URL returns JSON
  in a browser tab (mind the path base: LeadService has `/api/lead-service`, Customer360Service does
  not), then hit **Resync permissions** on the Applications page.
- **A registered app shows as unreachable** — ModuleRegistry's health prober couldn't fetch its
  `mf-manifest.json`. Confirm the remote's dev/preview server is up on its port.
- **A remote loads but renders unstyled** — it is missing `import '@omniremit/ui/tokens.css'` in its
  `App.tsx`, before `./index.css`. See
  [docs/SHARED-UI-REFACTOR-STATUS.md](docs/SHARED-UI-REFACTOR-STATUS.md) §2, which documents this and
  the other CSS traps that typecheck and build cannot catch.
- Anything else: check the terminal of whichever service is failing — every backend logs a clear
  error rather than failing silently.
