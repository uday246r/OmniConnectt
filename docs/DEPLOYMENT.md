# Deploying OmniConnect

**Step-by-step operations:** [RUNBOOK-RELEASE.md](RUNBOOK-RELEASE.md) covers first-time server setup,
releasing, promoting, rolling back, maintenance and troubleshooting.

**Why it is designed this way:** [adr/0001-release-by-pointer.md](adr/0001-release-by-pointer.md).

**Local development:** [SETUP.md](../SETUP.md).

## Topology

One host, one public port, everything else private. The building blocks:

| Piece | Where | Notes |
|---|---|---|
| nginx (`nginxinc/nginx-unprivileged`) | `deploy/nginx/` | The only published port. Serves every frontend build from `RELEASE_ROOT`, proxies the services. |
| AuthService | image `<registry>/auth` | Published at `/api` and `/hubs` (its refresh cookie is scoped to `/api/auth`). |
| LeadService | image `<registry>/lead` | `/api/lead-service` (path base). |
| Customer360Service | image `<registry>/customer360` | `/api/customer360-service` (path base). |
| ProductsService | image `<registry>/products` | `/api/products-service` (path base, incl. its SignalR hub). |
| PostgreSQL | managed | One database per service. |
| Redis | optional | Only for more than one AuthService replica (cache, locks, SignalR backplane). |

- **Configuration:** everything is in `deploy/compose.yml` plus `deploy/.env` and `deploy/env/*.env`.
  Templates are tracked; real files are git-ignored.
- **Path bases:** each service's path base is configurable (`Hosting__PathBase`) and also accepts
  unprefixed paths, so server-to-server callers address services directly by compose name.
- **Forwarded headers:** the services believe `X-Forwarded-For` only from the private network
  (`ForwardedHeaders__KnownNetworks`), and nginx overwrites the header. A spoofed client IP never reaches
  the rate limiter or the audit log.

## Frontend

- **Same origin by default.** Every app calls APIs on its own origin (`/api/...`), so one build runs in
  every environment. `pnpm release` forces this and refuses local `.env` files in CI.
- **Build layout.** Each build is published under its own versioned folder and never overwritten. Going
  live is a pointer move.
- **No CORS.** In production there is no cross-origin caller, so no CORS origins are configured.
- **Cookies.** The refresh cookie is first-party: `SameSite=Lax`, `Secure` in Production, no cookie domain.

## Security headers

`deploy/nginx/snippets/security-headers.conf` sets:
- `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy, COOP;
- a **report-only** Content-Security-Policy that allows only `'self'`, Google Fonts and Google Identity
  Services. Switch it to enforcing once a release has run clean.

HSTS is set with TLS (see `deploy/nginx/optional/tls.conf.example`).

## Retired topology

Until this release the platform deployed each frontend to its own Vercel project and each backend to
its own Render service (`render.yaml`, `apps/*/vercel.json`), on separate subdomains. That required CORS
on every remote, absolute manifest URLs, and a cross-site refresh cookie. Those files are kept for
reference while the old environment is wound down. They are not the production path, and absolute
manifest URLs are refused outside Development unless `RemoteApps__AllowAbsoluteManifestUrls=true`.
