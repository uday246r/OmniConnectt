# OmniConnect — Setup Guide for New Collaborators

Follow this top-to-bottom to get all five services running locally: **AuthService** (`:5155`),
**ModuleRegistry** (`:5200`), **EmployeeService** (`:5285`), the **host** frontend (`:5173`), and the
**employee_mf** remote micro-frontend (`:5001`). For architecture, endpoints, and what's built so
far, see [README.md](README.md) — this file is just the "get it running" runbook.

You'll provision your **own** Postgres databases and your **own** signing keys — nothing here is
shared with anyone else on the team, and you'll never need anyone else's secrets to run the project.

## 1. Prerequisites

Install these, then confirm each with its version command:

| Tool | Needed | Check |
|---|---|---|
| Node.js | v24+ | `node --version` |
| pnpm | 9+ | `pnpm --version` (see step 2 if missing) |
| .NET SDK | 10 | `dotnet --version` |
| Git | any recent | `git --version` |
| OpenSSL | any recent | `openssl version` |

- **pnpm**: if you don't have it, run `corepack enable` (ships with Node) — the repo pins the exact
  pnpm version via `packageManager` in `Frontend/package.json`, so pnpm will auto-install the right
  version the first time you run a pnpm command in that folder.
- **OpenSSL**: on Windows, Git Bash (installed alongside Git for Windows) already includes it. On
  macOS/Linux it's normally preinstalled. If truly unavailable, ask in the team chat — the key
  generation step below needs it.

## 2. Clone and install

```bash
git clone https://github.com/Ashok-2004/OmniConnect.git
cd OmniConnect
```

```bash
cd Frontend
pnpm install
```

```bash
cd ../Backend
dotnet restore
```

## 3. Provision your own three Neon Postgres databases

Each collaborator runs against their **own** databases — not a shared one. This keeps everyone's
local test data (users, roles, employees, etc.) independent, and means nobody has to hand you a
password over chat.

1. Sign up at [neon.tech](https://neon.tech) (there's a free tier, more than enough for local dev).
2. Create **three separate databases** — one for AuthService, one for ModuleRegistry, one for
   EmployeeService. (Either three databases in the same Neon project, or separate projects — either
   works, they just need to be three distinct databases, never shared between services. This is a
   deliberate architecture choice — see the README's note on why each service owns its own database
   instead of depending on another service's, for both no-downtime and performance reasons.)
3. For each, copy its connection string from the Neon dashboard. It'll look like:
   ```
   postgresql://neondb_owner:AbCdEf123456@ep-something-12345.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```
   **Don't use it in that exact form yet** — see the callout in step 5, it needs reformatting for
   this app's database driver (Npgsql).

## 4. Generate your own RS256 key pair

AuthService signs login tokens with a private key; ModuleRegistry and EmployeeService each check
them with the matching public key (never the private key — only AuthService ever holds that).
Generate your own pair — nobody else's key material is needed or should be reused:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private.pem
openssl rsa -pubout -in private.pem -out public.pem
```

Both `.env` files need each PEM's contents as a **single line**, with real newlines replaced by the
two literal characters `\n`. For example, a private key file like:
```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7...
...
-----END PRIVATE KEY-----
```
becomes one `.env` line:
```
Jwt__SigningKeyPrivate=-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7...\n...\n-----END PRIVATE KEY-----\n
```
Do the same for `public.pem`. Once both keys are copied into your `.env` files (step 6), delete
`private.pem` and `public.pem` from wherever you generated them — don't leave loose copies lying
around, and never commit them.

## 5. ⚠️ Connection string format — the one gotcha

Neon gives you a `postgresql://user:pass@host/db?sslmode=require&channel_binding=require` URL. The
database driver this project uses (Npgsql) **rejects that format outright** and will crash on
startup with `ArgumentException: Couldn't set postgresql://...`. Convert it to Npgsql's own format
first:

**Neon gives you:**
```
postgresql://neondb_owner:AbCdEf123456@ep-something-12345.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

**Use this instead** (same host/database/username/password, different syntax):
```
Host=ep-something-12345.us-east-2.aws.neon.tech;Port=5432;Database=neondb;Username=neondb_owner;Password=AbCdEf123456;SSL Mode=Require;Trust Server Certificate=true
```

Do this conversion for **all three** of your Neon connection strings before pasting them into the
`.env` files below. (The `channel_binding` parameter has no Npgsql equivalent and is safely dropped
— TLS, via `SSL Mode=Require`, is still fully enforced.)

## 6. Configure your `.env` files

Copy each `.env.example` to `.env` in the same folder, then fill in the blanks:

### `Backend/AuthService/.env`
```bash
cd Backend/AuthService
cp .env.example .env
```
Fill in:
- `ConnectionStrings__AuthDb` — your reformatted AuthService connection string (step 5)
- `Jwt__SigningKeyPrivate` — your private key, single-line `\n`-escaped (step 4)
- `Jwt__SigningKeyPublic` — your public key, single-line `\n`-escaped (step 4)
- `Internal__ApiKey` — any long random string you make up, e.g. `openssl rand -base64 32`. **Must
  match** `AuthService__InternalApiKey` in both ModuleRegistry's and EmployeeService's `.env` below —
  copy the same value into all three.

Everything else in this file already has a working default (`Cors__AllowedOrigins__0` is already set
to `http://localhost:5173`, which is correct as long as you run the frontend on its default port).

### `Backend/ModuleRegistry/.env`
```bash
cd ../ModuleRegistry
cp .env.example .env
```
Fill in:
- `ConnectionStrings__RegistryDb` — your reformatted ModuleRegistry connection string (step 5)
- `Jwt__SigningKeyPublic` — **the exact same public key** you put in AuthService's `.env` above
  (copy-paste it, don't regenerate)
- `AuthService__InternalApiKey` — **the exact same value** as `Internal__ApiKey` in AuthService's
  `.env` above

### `Backend/EmployeeService/.env`
```bash
cd ../EmployeeService
cp .env.example .env
```
Fill in:
- `ConnectionStrings__EmployeeDb` — your reformatted EmployeeService connection string (step 5)
- `Jwt__SigningKeyPublic` — **the exact same public key** you put in the other two `.env` files
- `AuthService__InternalApiKey` — **the exact same value** as `Internal__ApiKey` in AuthService's `.env`

### `Frontend/apps/host/.env`
```bash
cd ../../Frontend/apps/host
cp .env.example .env
```
No changes needed — the defaults (`VITE_AUTH_SERVICE_URL=http://localhost:5155`,
`VITE_MODULE_REGISTRY_URL=http://localhost:5200`) already point at the other services' default ports.

### `Frontend/apps/employee_mf/.env`
```bash
cd ../employee_mf
cp .env.example .env
```
No changes needed — the defaults already point at EmployeeService (`:5285`) and AuthService (`:5155`).

## 7. Run all five services

Each in its own terminal, from the repo root:

```bash
dotnet run --project Backend/AuthService
```
```bash
dotnet run --project Backend/ModuleRegistry
```
```bash
dotnet run --project Backend/EmployeeService
```
```bash
cd Frontend
pnpm --filter host dev
```
```bash
cd Frontend
pnpm --filter employee-mf preview
```
The last one first needs a build (`pnpm --filter employee-mf build`) if you haven't run one yet —
`preview` serves the `dist/` output it produces, which is what publishes `mf-manifest.json` for the
host to load at runtime. Re-run `build` after any change to `Frontend/apps/employee_mf/src`.

Each backend **automatically applies its database migrations on first startup** — you don't need to
run any `dotnet ef` commands yourself. Watch the AuthService terminal for a one-time line like:

```
warn: AuthService[0]
      Seeded bootstrap Super Admin account. Email: superadmin@omniconnect.local | Temporary password: ...
```

That only appears **once**, the very first time AuthService starts against your empty database — copy
that password down immediately, since it's never logged again. (There's currently no self-service
"change password" screen in the app, so treat that value as your login for now.)

## 8. Verify it's working

Open **http://localhost:5173**, sign in with the email/password from the log line above. You should
land on the dashboard showing real counts (1 user, 6 roles, 0 registered apps) — that confirms the
frontend, both backends, and your Neon databases are all talking to each other correctly.

### Registering the Employee remote app

The `employee_mf` server being up isn't enough on its own — like any remote app, it only appears once
an administrator registers it in **Setup → Applications → + Register App**:

| Field | Value |
|---|---|
| Key | `employee` |
| Display name | `Employee Management` (or anything you like) |
| Manifest URL | `http://localhost:5001/mf-manifest.json` |
| Permissions source URL | `http://localhost:5285/api/employee-service/permissions` |

The Permissions source URL is what makes this platform's permission system dynamic: ModuleRegistry
fetches it on save (and on **Resync permissions**, from the same Applications page) to learn
EmployeeService's current capabilities (Create/Edit/Delete today) and pushes them into AuthService's
catalog automatically — nothing about the capability list is hand-typed anywhere. After registering,
"Employee Management" appears in the sidebar, and its capabilities appear under a new "Remote apps"
group in every role's permission editor (**Setup → Role**) — grant whichever ones a role should have.
As the Super Admin, everything is already granted (administrators bypass per-capability checks).

### Enabling Google SSO (optional)

Google Sign-In ships fully wired but **inert by default**. While unconfigured the login page hides
the SSO block entirely — no button, no "OR" divider, and Google's script is never even requested —
so the form reads as a deliberate password-only login rather than one with a broken alternative.

Configuration is **backend-only**: the browser reads the Client ID from `GET /api/auth/sso-config`
at runtime, so enabling SSO needs no frontend rebuild and rotating the ID needs no redeploy.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth
   2.0 Client ID** of type "Web application".
2. Add your frontend origin under **Authorized JavaScript origins** — `http://localhost:5173` for
   local work, plus your real origin for production (no path, no trailing slash). No redirect URI is
   needed: Google Identity Services returns the credential to the page, not via a redirect.
3. Set **both** of these in `Backend/AuthService/.env`:
   - `Google__ClientId=` — the generated Client ID. It is public by design (Google requires it in
     the page), so it is not a secret, but it still belongs in `.env` rather than a committed default.
   - `Google__AllowedDomains=` — comma-separated email domains permitted to sign in, e.g.
     `acme.com,acme.co.uk`. **Both must be set**: an empty domain list means nobody can sign in, which
     is the safe default rather than an oversight.
4. Restart AuthService. The button appears on the next page load — no frontend rebuild.
5. Create a user with **Authentication Method: Google SSO** in Setup → User. SSO never auto-creates
   an account: an administrator still provisions the User row first, just with no password. That
   user's email domain must be one of the allowed domains from step 3.
6. That user can now sign in with the Google button on the login page.

Three rejections are reported distinctly, so a failure is diagnosable: SSO not configured (503),
domain not on the allowlist (401), and no provisioned account for that Google identity (401).

> `VITE_GOOGLE_CLIENT_ID` in `Frontend/apps/host/.env` is **no longer used** and can be removed. The
> Client ID is served from AuthService so that one build runs in every environment.

### Enabling email — set-password invites (optional)

When an administrator creates a user, the new account can be emailed a **single-use, time-limited
link** to choose their own password. This is preferred over emailing the temporary password: a link
expires, dies on first use, and never leaves a working credential sitting in a mailbox.

Like SSO, this is **inert until configured** — without SMTP settings no mail is attempted, account
creation succeeds exactly as before, and the maker collects the temporary password from My Requests
as usual. That fallback remains available even once email is on, for users who cannot receive mail.

Set these in `Backend/AuthService/.env`:

- `Smtp__Host` — e.g. `smtp.gmail.com`, `smtp.office365.com`, or your corporate relay
- `Smtp__Port` — `587` for STARTTLS (typical) or `465` for implicit TLS
- `Smtp__Username` / `Smtp__Password` — mailbox credentials. For Google Workspace this must be an
  **App Password**, not the account password. Leave both blank for an internal relay that accepts
  mail from trusted hosts without authentication.
- `Smtp__FromAddress` — sender address; defaults to `Smtp__Username` if omitted
- `Smtp__FromName` — display name, defaults to `OmniConnect`
- `Smtp__AppBaseUrl` — **required.** The public URL of the frontend, e.g. `http://localhost:5173` or
  `https://app.yourcompany.com`. Invite links are built from this. It cannot be inferred from the
  request: the `Host` header is attacker-controllable, and an invite link is precisely the kind of
  thing that must never be built from one.
- `Smtp__InviteValidHours` — link lifetime, default `48`

All three of `Smtp__Host`, a resolvable sender, and `Smtp__AppBaseUrl` must be present before any
mail is sent — a half-configured deployment stays silent rather than promising an email that cannot
arrive with a link that would not work.

Connections always use TLS. Port 465 connects with implicit TLS; anything else requires a successful
STARTTLS upgrade and fails rather than silently falling back to an unencrypted session.

**These credentials are secrets** — keep them in the gitignored `.env`, never in `appsettings.json`.

## Troubleshooting

- **A backend crashes immediately on startup** ("address already in use") — something else is already
  running on that port. Stop it, or check nothing else on your machine uses 5155/5200/5285/5173/5001.
- **Frontend terminal says it can't bind to 5173** — same thing, one instance at a time; the dev
  server is configured to fail loudly here instead of silently switching ports (a silent port switch
  would break login with a confusing CORS error instead).
- **Login fails with a CORS error in the browser console** — your `Cors__AllowedOrigins__0` in every
  backend `.env` file must exactly match the URL the frontend is actually running at
  (`http://localhost:5173` by default — no trailing slash, exact scheme/host/port).
- **A backend crashes with an Npgsql/connection-string error** — you're probably still using Neon's
  raw `postgresql://...` URL; see step 5.
- **Employee Management never appears in the sidebar after registering it** — its capabilities didn't
  come back from `Permissions source URL`. Check EmployeeService is actually running on `:5285` and
  that `http://localhost:5285/api/employee-service/permissions` returns JSON in a browser tab, then
  hit **Resync permissions** on the Applications page.
- **"Sign in with Google" still shows "not configured"** after setting the env vars — confirm you set
  `VITE_GOOGLE_CLIENT_ID` in `Frontend/apps/host/.env` (not just `Backend/AuthService/.env`'s
  `Google__ClientId`) and restarted the frontend dev server — Vite only reads `.env` at startup.
- Anything else: check the terminal output of whichever service is failing — every backend logs clear
  error messages rather than crashing silently.
