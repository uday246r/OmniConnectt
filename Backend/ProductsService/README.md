# Product Marketplace API

ASP.NET Core (net10.0) API for the Product Marketplace remote.

## Getting started

Everything runs from **this folder**. There is no solution file and no nested project path to
remember — one command each:

```bash
dotnet build
```

```bash
dotnet run
```

The API listens on `http://localhost:5266` (Swagger at `/swagger` in development).

### One-time database setup

Copy the example env file and fill in your connection string:

```bash
cp .env.example .env
```

Then edit `.env`:

```
ConnectionStrings__DefaultConnection="Host=...;Port=5432;Database=...;Username=...;Password=...;SSL Mode=Require;Trust Server Certificate=true;Channel Binding=Require"
```

That's it — `.env` is loaded automatically on every `dotnet run`, from this folder, with no extra
flags or commands. It is gitignored and never committed; `.env.example` (committed, no real values)
documents the shape for the next developer.

The API fails fast with an explanatory message if no connection string is found anywhere, so a
machine that hasn't been configured tells you exactly what to do.

## Layout

```
backend/
├── ProductMarketplace.Api.csproj   ← the entry point: build and run from here
├── Program.cs, Controllers/, Services/
└── src/
    ├── ProductMarketplace.Application/   DTOs, service interfaces
    ├── ProductMarketplace.Domain/        entities
    └── ProductMarketplace.Infrastructure/ EF Core, service implementations, migrations
```

The clean-architecture layering is unchanged — `Api` → `Application` → `Infrastructure` → `Domain`.
The host project simply sits at the root so the folder you open is the folder you build and run in.
Building here builds all four projects.

## Configuration

No credential is stored in `appsettings.json`. Configuration is resolved in this order, each level
able to override the one before it:

1. `appsettings.json` / `appsettings.{Environment}.json` — no secrets live here, ever.
2. **`.env`** (this folder, gitignored) — loaded automatically at startup via `DotNetEnv`. This is
   the local development path described above.
3. Real process/OS environment variables — e.g. `ConnectionStrings__DefaultConnection` set by a
   container, CI runner or deployment platform. These always win over `.env`, so a value baked into
   a deployed environment can never be shadowed by a leftover local file.

`.env` uses the same double-underscore key convention .NET configuration expects for nested keys
(`ConnectionStrings__DefaultConnection` → `ConnectionStrings:DefaultConnection`), so the same key
works whether it comes from `.env` or a real environment variable.

**Deployed environments** don't use `.env` at all (it isn't deployed with the app) — set the
environment variable directly:

```
ConnectionStrings__DefaultConnection=<connection string>
```

### Other settings

| Key | Default | Purpose |
| --- | --- | --- |
| `Cors:AllowedOrigins` | `localhost:5173`, `127.0.0.1:5173` | Origins allowed to call the API. |
| `Database:ApplyMigrationsOnStartup` | `true` | Set `false` to apply migrations as a separate deploy step instead of on boot. |
| `Database:RunSeedOnStartup` | Development only | Demo/sample data. Status reference data is always provisioned; demo content never seeds itself in a deployed environment. |
| `Swagger:Enabled` | Development only | Swagger UI is not exposed outside development by default. |
| `Audit:TrustActorHeaders` | Development only | Whether `X-Actor-*` request headers may name the audit actor. See below. |

## Authentication and identity

This remote **does not authenticate anyone**. The Host App owns authentication, user identity, roles
and permissions; this service is designed to consume them after integration:

- `HttpAuditContext` resolves the audit actor from an authenticated `ClaimsPrincipal` whenever one is
  present. That path takes precedence automatically the moment the Host App supplies a real session —
  no service that depends on `IAuditContext` changes.
- The `X-Actor-Name` / `X-Actor-Email` header fallback exists only for standalone development. Those
  headers are caller-supplied and therefore untrusted, so they are honoured only when
  `Audit:TrustActorHeaders` is enabled (Development by default). With no authentication wired up in a
  deployed environment, the actor is recorded as `System` rather than as whatever the caller claimed,
  so the audit trail cannot be silently forged.
- `app.UseAuthorization()` remains in the pipeline as the hook where Host-issued authentication and
  policies attach.

## Data integrity notes

- **Category display order** is kept unique and contiguous per sibling set by `CategoryService`.
  Changing one category's order re-inserts it at that position and renumbers the rest (1..N); deleting
  one closes the gap it left. Migration `NormalizeCategoryDisplayOrder` brings pre-existing rows in
  line with that invariant.
- **`Product.ApplicationCount`** is denormalised so the database can sort and rank on it, but it is
  recomputed from the `Applications` table after every write rather than incremented, so it cannot
  drift.
- **Status values** are not a closed enum. `StatusConfig` is the source of truth per entity type;
  every write validates against it, and a caller that omits a status gets the configured default
  rather than a hardcoded literal.

## Database migrations

Migrations live in the Infrastructure project, so schema changes name it explicitly (run from this
folder):

```bash
dotnet ef migrations add <Name> --project src/ProductMarketplace.Infrastructure
```

Applying them needs nothing extra — `dotnet run` migrates on startup.
