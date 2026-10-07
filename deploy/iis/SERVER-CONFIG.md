# Deploying to a Windows/IIS server — the configuration that local development supplies for you

Everything here is **configuration on the server**. No application code needs to change; the code is
identical to the one that works locally.

## Why "works locally, broken on the server" happens at all

Locally every service runs with `ASPNETCORE_ENVIRONMENT=Development`, so it loads
`appsettings.Development.json` **in addition to** `appsettings.json`. On the server the environment is
Production, that file is never read, and anything that lived only there is silently absent — the
service still starts, still reports healthy, and only fails on the one feature that needed the value.

These are the keys that exist **only** in a Development file:

| Service | Key missing in Production | What breaks without it |
|---|---|---|
| AuthService | `RemoteApps:InternalBaseUrl` | **every remote app reported Unreachable → "Degraded"** |
| LeadService | `AuthService:BaseUrl`, `AuthService:InternalApiKey` | approval gating on every lead write (503) |
| Customer360Service | `AuthService:BaseUrl`, `AuthService:InternalApiKey` | same |
| ProductsService | *(none)* | — which is why the Marketplace keeps working |

That last row is the tell: the Marketplace can create products on the server while Lead Management
cannot create a lead, because ProductsService is the only one of the four with nothing Development-only.

## 1. All remote apps show "Degraded" — `RemoteApps__InternalBaseUrl`

This is not a frontend bug and not related to the services' own `/health`. Those endpoints answer fine,
which is exactly what you observed.

AuthService decides a remote's health by fetching its **`mf-manifest.json`** from the web server. In
production a manifest URL is root-relative (`/modules/lead/1.0.0/mf-manifest.json`), and
`RemoteManifestClient.Resolve()` can only turn that into a real address using
`RemoteApps:InternalBaseUrl`. Unset, it returns null and the probe reports, verbatim:

> This manifest URL is a path on the platform's own web server, but RemoteApps:InternalBaseUrl is not
> configured, so AuthService cannot reach it.

Every remote fails the same way at the same moment — which is why *all* of them went red at once.

**Fix.** In the deployed **AuthService** `.env`, point it at the IIS site that serves the frontend
(the site whose folder contains `index.html`, `host\` and `modules\`) — not at AuthService itself:

```
RemoteApps__InternalBaseUrl=http://localhost:5173
```

Use whatever port that IIS site actually listens on. Restart AuthService; the prober re-sweeps every
5s while anything is unhealthy, so the sidebar should go green within seconds.

**Verify from the server:**

```
curl http://localhost:5173/modules/lead/1.0.0/mf-manifest.json
```

It must return JSON containing a `"name"` field. Two ways this still fails:

- **404** — `modules\` is not at the site root. `index.html` references `/host/<version>/...` and
  `/modules/<key>/<version>/...` absolutely, so the site root must be the unpacked release root, with
  `host\<version>\index.html` **copied** to the root as `index.html`. Pointing the site at
  `host\<version>` instead breaks every asset.
- **HTML comes back instead of JSON** — your SPA fallback is answering a missing file with
  `index.html` and HTTP 200. The probe then reports *"The URL responded, but the body is not a Module
  Federation manifest (no 'name' field)"* and marks the app Unreachable. The `web.config` in this
  folder fixes that by returning a real 404 under `/host/` and `/modules/`.

## 2. Lead writes — `AuthService__BaseUrl` / `AuthService__InternalApiKey`

Add to the deployed **LeadService** and **Customer360Service** `.env` files:

```
AuthService__BaseUrl=http://localhost:5155
AuthService__InternalApiKey=<the matching per-service key from AuthService's .env>
```

The key must equal `Internal__Services__LeadService__ApiKey` (respectively
`__Customer360Service__ApiKey`) in AuthService's own `.env`. Adding the *first* per-service key retires
the legacy shared `Internal__ApiKey` immediately, so every calling service must be added in the same
edit or the ones you missed start getting 401s.

Check one directly:

```
curl -H "X-Internal-Api-Key: <key>" http://localhost:5155/internal/capabilities/<any-guid>
```

## 3. Everything else the server needs in `.env`

`publish\appsettings.json` ships with **empty** connection strings and keys by design — all real values
come from a `.env` file read at startup, and **`.env` is not part of the publish output**. Copy it next
to the deployed DLL (`AppContext.BaseDirectory` is the reliable lookup location of the three the code
tries). Per service, confirm at minimum:

- `ConnectionStrings__<X>Db`
- `Jwt__SigningKeyPublic` — identical in all four services
- `Cors__AllowedOrigins__0` — **the browser's origin as typed in the address bar on the server**
- `ProductsService__BaseUrl` + `ProductsService__InternalApiKey` (LeadService → catalogue)
- `Self__PublicBaseUrl` — this service's externally reachable base URL *including* its path base

Write `.env` with **LF line endings and no quotes around values**. A trailing `\r` from a CRLF file
ends up inside an HTTP header value and makes `HttpRequestMessage.Headers.Add` throw a
`FormatException`, which surfaces as an unexplained 500.

## 4. Getting the real cause of a 500

A 500 from any service is its `ExceptionMiddleware` catching something it does not map (a 503, 400,
401 or 404 would have carried a real message instead). The body deliberately hides the detail behind
`Reference: <trace id>`. The exception itself is recorded in two places:

1. **System Logs in the host UI** (`/system/system-logs`, permission `host.system.system-logs`) — the
   service pushes every unhandled exception there **with its full stack trace**. Open the entry and
   look for `POST /api/leads failed: <ExceptionType>: <message>`.
2. **stdout on the server.** The published `web.config` has `stdoutLogEnabled="false"`, so the console
   is being discarded. Set it to `"true"`, create a `logs` folder beside the DLL, grant the app-pool
   identity write access, reproduce once, read `logs\stdout_*.log`, then set it back to `"false"`.

For lead creation specifically, these are already ruled out by the code and are **not** what a 500
means: catalogue unreachable (503), approval gating (503), unrecognised state or withdrawn product
(400), capability denied (401/403), audit-log push (swallowed). What remains is overwhelmingly a
database write — a missing migration or a constraint — which the stack trace will name outright.
