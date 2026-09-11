# OmniRemit — Setup Guide for New Collaborators

Follow this top-to-bottom to get all six components running locally:

| Component | Port |
|---|---|
| AuthService | 5155 |
| LeadService | 5046 |
| Customer360Service | 5059 |
| host frontend | 5173 |
| lead_mf remote | 5002 |
| customer360_mf remote | 5003 |

For architecture and what's built, see [README.md](README.md) — this file is just the "get it
running" runbook.

You provision your **own** PostgreSQL databases and your **own** signing keys. Nothing here is shared
with anyone else on the team, and you never need anyone else's secrets to run the project.

## 1. Prerequisites

| Tool | Needed | Check |
|---|---|---|
| Node.js | v24+ | `node --version` |
| pnpm | 9+ | `pnpm --version` (see below if missing) |
| .NET SDK | 10 | `dotnet --version` |
| PostgreSQL | 14+, local or the Docker image | `psql --version` |
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

## 3. Provision your own three PostgreSQL databases

Each service owns its **own** database — never shared between services, and never shared between
collaborators. This is deliberate: it is what lets one service be migrated or redeployed without
taking another down.

Create three empty databases:

| Database | Used by | Connection string key |
|---|---|---|
| `omniconnect_auth` | AuthService | `AuthDb` |
| `omniconnect_lead` | LeadService | `LeadDb` |
| `omniconnect_customer360` | Customer360Service | `Customer360Db` |

You do **not** need to create any tables — each service applies its own EF Core migrations on first
startup.

```sql
CREATE DATABASE omniconnect_auth;
CREATE DATABASE omniconnect_lead;
CREATE DATABASE omniconnect_customer360;
```

To run Postgres in Docker:

```bash
docker run -e POSTGRES_PASSWORD=<your-password> -p 5432:5432 -d postgres:16
```

### Where the connection strings go

> **`.env`, and nowhere else.** Every `ConnectionStrings:*` entry in every `appsettings.json` is
> deliberately blank — the key is present so the config binding shape is unchanged, but the value must
> come from that service's gitignored `.env`. Committing a real value back into `appsettings.json` is
> how this repository leaked four live database passwords once already.

ASP.NET Core maps a double underscore to a nested key, so `ConnectionStrings__AuthDb` becomes
`ConnectionStrings:AuthDb`. In `Backend/AuthService/.env`:

```
ConnectionStrings__AuthDb=Host=localhost;Port=5432;Database=omniconnect_auth;Username=postgres;Password=<your-password>
```

Repeat with the right `Database` name and key for each of the other two.

> **Precedence matters.** `.env` values are loaded into real environment variables before the host
> builder runs, and environment variables **outrank** `appsettings.Development.json`. This is the
> mechanism that lets the same source deploy to production unchanged.

> If a service starts with no connection string set it will **not** crash — it logs a warning and
> serves, but every database-backed endpoint fails and `/health` reports Unhealthy until you configure
> it. That is intentional, so a misconfiguration is diagnosable rather than a startup crash loop.

## 4. Generate your own RS256 key pair

AuthService signs login tokens with a private key; LeadService and
Customer360Service verify them with the matching public key. Only AuthService ever holds the
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

- your **public key** — in all three backend `.env` files (AuthService also holds the private key)
- the **internal API key** — `Internal__ApiKey` in AuthService, and `AuthService__InternalApiKey`
  plus `Internal__ApiKey` in each of the other two. Generate one with `openssl rand -base64 32`
  and paste the same value into all of them.

The **connection strings are required** — `appsettings.json` carries no default for any of them
(step 3).

> ⚠️ `Backend/LeadService/.env.example` previously shipped a real internal API key and a real public
> key committed into the repo. Both are now blank, but **treat that internal API key as compromised
> anywhere it has ever been used** — it is still in the git history. Generate a fresh one and use it
> in all three services.

### `Backend/AuthService/.env`

```bash
cp Backend/AuthService/.env.example Backend/AuthService/.env
```

Fill in:
- `ConnectionStrings__AuthDb` — **required**; there is no default in `appsettings.json`
- `Jwt__SigningKeyPrivate` / `Jwt__SigningKeyPublic` — both keys, single-line `\n`-escaped (step 4)
- `Internal__ApiKey` — the shared internal key
- `Security__TempPasswordKey` — 32 random bytes, base64: `openssl rand -base64 32`. Without it,
  approving a gated user creation is **refused** (fail closed) rather than silently losing the
  generated temporary password.

Everything else has a working local default — `Cors__AllowedOrigins__0` is already
`http://localhost:5173`.


### `Backend/LeadService/.env`

```bash
cp Backend/LeadService/.env.example Backend/LeadService/.env
```

Fill in `Jwt__SigningKeyPublic`,
`AuthService__InternalApiKey` and `Internal__ApiKey`. `ConnectionStrings__LeadDb` is required — there is no default in `appsettings.json`.

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

Fill in `Jwt__SigningKeyPublic`, `AuthService__InternalApiKey`
and `Internal__ApiKey`. `Self__FieldSettingsModuleKey` is the same kind of runtime value as
LeadService's — leave it blank initially.

`CrmApi__BaseUrl` / `CrmApi__ClientId` / `CrmApi__ClientSecret` point at the external CRM this
service proxies. Leave them blank unless you have real credentials; the rest of the service works
without them.

### `Frontend/apps/host/.env`

```bash
cp Frontend/apps/host/.env.example Frontend/apps/host/.env
```

No changes needed — `VITE_AUTH_SERVICE_URL` already points at the default backend port. It is
**required**: the host throws at startup with a clear message rather than letting a blank base URL
produce confusing network errors later.

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

Each in its own terminal, from the repo root.

Start **LeadService and Customer360Service before AuthService** on a first run. AuthService reads each
remote's capability list from that remote's own backend (`PermissionsSourceUrl`) when registering or
resyncing it; if those backends are not listening yet, it keeps whatever it already has — which on a
first run is nothing, giving you a sidebar with no apps in it. It is recoverable at any time (Setup →
Applications → **Resync Permissions** does the same work on demand), but it is easier to avoid. After
the first successful boot the order no longer matters.

**1. LeadService and Customer360Service** — each creates its own schema and exposes `/permissions`:

```bash
dotnet run --project Backend/LeadService
```

```bash
dotnet run --project Backend/Customer360Service
```

**2. AuthService** — creates its schema, seeds the permission catalog, roles and the bootstrap admin,
then discovers each registered remote's capabilities:

```bash
dotnet run --project Backend/AuthService
```

**3. The three frontends:**

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

Note what the remotes' `dev` script actually does: `concurrently "vite build --watch" "vite preview"`.
Unlike the host, a remote is **built and served from `dist/`**, not from a dev server — that is what
publishes `mf-manifest.json`. So a remote takes a few seconds longer to come up on first start, and
the host cannot load it until `http://localhost:5002/mf-manifest.json` returns 200.

Each backend **applies its database migrations automatically on first startup** — no `dotnet ef`
commands required. Watch the AuthService terminal for a one-time line like:

```
warn: AuthService[0]
      Seeded the bootstrap Super Admin account.
        Email:    superadmin@omniconnect.com
        Password: <a random 14-character password>
      This is printed once and cannot be recovered. Sign in, change it immediately, and clear it
      from your terminal scrollback.
```

**Copy that password now.** It is generated per install, printed exactly once, and only its hash is
stored — there is no way to read it back. If you lose it before signing in, delete the row from
`Users` (or drop the database) and let the seeder run again.

The seeded account is flagged `MustChangePassword`, and `MustChangePasswordFilter` is registered
globally, so it can reach nothing but the change-password endpoint until you replace the password.

## 7. Verify it's working

Open **http://localhost:5173** and sign in:

- **Email:** `superadmin@omniconnect.com`
- **Password:** the one printed in the AuthService startup log (see above)

> You will be prompted to set a real password immediately — the seeded account is flagged
> `MustChangePassword` and can reach no other endpoint until you do.

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

The **Permissions source URL** is what makes the permission system dynamic: AuthService fetches it
on save (and on **Resync permissions**, from the same page) to learn that service's current
capabilities and reconciles them into its own catalog automatically — no capability list is
hand-typed anywhere. After registering, the app appears in the sidebar, and its capabilities appear
under a "Remote apps" group in every role's permission editor. As Super Admin you already have
everything (administrators bypass per-capability checks).

AuthService also background-probes each `ManifestUrl`, so an app whose server is down is shown as
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
  nothing else uses 5155 / 5046 / 5059 / 5173 / 5002 / 5003.
- **The frontend can't bind to 5173** — same thing, one instance at a time. The dev server is
  configured to fail loudly rather than silently switch ports, because a silent switch would break
  login with a confusing CORS error instead.
- **Login fails with a CORS error** — `Cors__AllowedOrigins__0` in each backend `.env` must exactly
  match the URL the frontend actually runs at (`http://localhost:5173` by default; no trailing slash,
  exact scheme/host/port). Development also reads these from `appsettings.Development.json`.
- **A backend logs "ConnectionStrings__... is not set"** — it starts anyway, but every DB-backed
  endpoint fails. Fill in that service's connection string and restart.
- **A backend still tries to reach an old/remote server even though `appsettings.Development.json`
  says `localhost`** — an environment variable is winning. Environment variables outrank
  `appsettings.Development.json`, and `.env` files are loaded *as* environment variables. Check for
  an uncommented `ConnectionStrings__*` line in that service's `.env`, and for a stale value in your
  shell (`echo $env:ConnectionStrings__AuthDb` in PowerShell).
- **`28P01 password authentication failed` / `3D000 database ... does not exist`** — the credentials
  reached Postgres but the role has no access, or the database was never created. Confirm all four
  `omniconnect_*` databases exist and that the role in your connection string can open them.
- **A backend hangs for ~30s then fails on every DB call** — the connection string points somewhere
  unreachable. `EnableRetryOnFailure` retries six times with backoff before surfacing the error, so a
  wrong host looks like a hang rather than an immediate failure.
- **`dotnet ef database update` seems to target the wrong database** — AuthService
  have an `IDesignTimeDbContextFactory`, and EF prefers it over the application's host builder. Both
  now read the same configuration the running service does, so `dotnet ef dbcontext info` should
  report `Database name: omniconnect_auth`. If it reports something else, configuration is being
  resolved from a different working directory — run the command from inside the service's project
  folder.
- **A backend can't reach Postgres over TLS** — a local or Docker instance usually needs
  `SSL Mode=Disable`. A hosted one (Neon, RDS) needs `SSL Mode=Require;Trust Server Certificate=true`.
  Do not disable TLS against anything but a local instance.
- **The session drops moments after a successful login** — the refresh cookie isn't coming back. On
  localhost `Auth__SameSite=Lax` is correct. Only set `None` when the frontend and API are genuinely
  cross-site, and note that `None` also requires a Secure cookie, which is enforced at startup.
- **A registered app never appears in the sidebar** — its capabilities didn't come back from
  `Permissions source URL`. Confirm the service is running and that the permissions URL returns JSON
  in a browser tab (mind the path base: LeadService has `/api/lead-service`, Customer360Service does
  not), then hit **Resync permissions** on the Applications page.
- **A registered app shows as unreachable** — the health prober could not fetch its
  `mf-manifest.json`. Confirm the remote's dev/preview server is up on its port.
- **A remote loads but renders unstyled** — it is missing `import '@omniremit/ui/tokens.css'` in its
  `App.tsx`, before `./index.css`. See
  [docs/SHARED-UI-REFACTOR-STATUS.md](docs/SHARED-UI-REFACTOR-STATUS.md) §2, which documents this and
  the other CSS traps that typecheck and build cannot catch.
- Anything else: check the terminal of whichever service is failing — every backend logs a clear
  error rather than failing silently.
