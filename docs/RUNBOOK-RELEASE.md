# Release runbook

How OmniConnect is built, released, promoted, rolled back and put into maintenance in production.
The design and why it is this way: [adr/0001-release-by-pointer.md](adr/0001-release-by-pointer.md).
**Installing on Windows Server 2022** (WSL2 + Docker, Caddy for HTTPS, PostgreSQL on the same machine),
step by step for someone new to deployment: [DEPLOY-WINDOWS-SERVER-2022.md](DEPLOY-WINDOWS-SERVER-2022.md).

## The model in five lines

1. **One public URL.** nginx is the only exposed port. It serves the host at `/` and every remote under
   `/modules/<key>/<version>/`, and it proxies the four services under `/api/…`. No remote and no
   service has a URL of its own.
2. **One release artifact.** `pnpm release` builds the host and each remote separately (Module
   Federation still loads remotes at runtime). It lays every build out in its own versioned folder and
   writes `release-manifest.json`, then produces a checksummed tarball.
3. **Deploys only add files.** A version folder is never overwritten. A version that already exists with
   different content is refused.
4. **Going live is a pointer move.**
   - **A remote:** its registered manifest URL moves to the new folder. No container restarts, the host
     is not rebuilt, and no other remote is touched.
   - **The host:** `current/index.html` is swapped atomically.
5. **Rollback is the same move backwards.** It is instant, because the old build is still on disk.

```
Browser ──► nginx :443 ─┬─ /                          current/index.html            (no-cache)
                        ├─ /host/<v>/…                 host build                   (immutable)
                        ├─ /modules/<key>/<v>/…        remote builds                (immutable)
                        ├─ /api/lead-service/…         ──► lead:8080
                        ├─ /api/customer360-service/…  ──► c360:8080
                        ├─ /api/products-service/…     ──► products:8080 (+ SignalR hub)
                        └─ /api/…, /hubs/…             ──► auth:8080
                         (/api/*-service/internal|permissions|swagger → 404 from outside)
```

## Versions

| What | Where it is set | Rule |
|---|---|---|
| Each remote | `version` in its `package.json` | Bump it whenever its code changes; it names the folder. |
| Host | `version` in `apps/host/package.json` | Same. |
| Host bridge contract | `HOST_BRIDGE_VERSION` in `packages/host-bridge/src/contract.ts` | Minor for an added optional member, major for a removed or changed one. |
| What a remote needs | `omniconnect.requiredHostBridge` in its `package.json` | A SemVer range, e.g. `^1.0.0`. Required; the build fails without it. |
| Release | `releaseVersion` in `release-manifest.json` | `YYYYMMDD.HHMMSS-<commit>`, generated. |
| Backend images | `*_TAG` in `deploy/.env` | The commit SHA (set by the release pipeline). |

**Which build is live right now:**
- `GET /release-manifest.json` on the site shows the release.
- `deploy/scripts/promote.sh --list` shows the per-app history: live, superseded, who promoted it, when.

## First-time server setup

1. **Install software.** A Linux host with Docker (compose v2), `jq`, `curl` and `rsync`.
2. **Copy the deploy folder.** Put `deploy/` at e.g. `/opt/omniconnect/deploy`. The release pipeline keeps it in sync.
3. **Create the environment files.**
   - `cp deploy/.env.example deploy/.env`.
   - For each service, `cp deploy/env/<svc>.env.example deploy/env/<svc>.env`.
   - Fill in every value.
   - Generate each key with `openssl rand -hex 32`. The comments in each file say which values must match across files.
   - Generate the RS256 pair as described in SETUP.md.
4. **Databases.** Create one PostgreSQL database per service on the managed server: `auth_service`, `lead_service`, `customer360_service`, `products_service`.
   - **ProductsService must start from an empty database.** Its migrations were rebuilt (Category → Sub-category → Product), and the pre-rebuild schema cannot be migrated forward.
5. **TLS.** Terminate it at your load balancer, or at this nginx with `deploy/nginx/optional/tls.conf.example`.
6. **Release folder.** `mkdir -p /srv/omniconnect` (the `RELEASE_ROOT`).

## Release

The normal path is CI:
1. Tag `vYYYY.MM.DD` (or "Run workflow" on *Release*).
2. Images are pushed tagged by commit, and the frontend tarball is attached to the GitHub Release.
3. The *Deploy to production* job waits for a required reviewer, then runs `deploy.sh` on the server.

To release by hand from a workstation:

```bash
cd Frontend && pnpm release                       # all checks, then build + assemble
pnpm release -- --since v2026.10.01 --reuse release/<previous-id>.tar.gz   # only what changed since that tag
pnpm release -- --only lead --reuse release/<previous-id>.tar.gz           # just Lead
scp release/<id>.tar.gz* server:/opt/omniconnect/releases-incoming/
ssh server /opt/omniconnect/deploy/scripts/deploy.sh /opt/omniconnect/releases-incoming/<id>.tar.gz
```

**Incremental releases.** CI does this automatically: it finds the previous `v*` tag, downloads that
release's artifact and rebuilds only the apps whose files changed since. A change to anything all apps
are built from (`packages/`, the lockfile, workspace or TypeScript config, the release script) rebuilds
all of them. Builds are byte-for-byte reproducible, so an unchanged app taken from the previous release
is identical to a rebuild — and an app whose code changed while its `version` did not fails the build
with "Bump "version" in its package.json", before it can reach a server.

**What `deploy.sh` does:**
1. Verifies the checksum.
2. Adds the version folders.
3. Runs every service's migrations once (`--migrate-only`, a single writer). **A failed migration stops here, before anything users see changes.**
4. Runs `docker compose up -d --wait`. Only services whose image changed are recreated.
5. Registers each build with AuthService, which checks the folder holds the app it claims to be.
6. Promotes, in this order:
   - remotes the live host can run;
   - the host (atomic swap);
   - remotes that needed the new host.
7. Runs the smoke test (`scripts/smoke.sh`, 18 checks).

**Any failure after step 6 moves every pointer back.**

A **remote-only release** restarts nothing. Pass `--frontend-only` to skip the backend steps entirely.

### What users with the app already open see
- A tab that already has the old build of a remote open keeps running it; its files are still served. Nobody loses a half-filled form.
- The sidebar updates within a second: AuthService pushes a navigation change over SignalR.
- The next time the user enters that app, they get "A new version of … is available — Reload now".
- New tabs get the new build immediately.

## Promote and roll back

```bash
deploy/scripts/promote.sh --list lead          # history
deploy/scripts/promote.sh lead 4.7.3           # make an installed build live
deploy/scripts/rollback.sh lead                # back to the build that was live before
deploy/scripts/rollback.sh --release <id>      # the whole frontend back to an earlier release
```

**Refused promotions.** AuthService refuses:
- a remote whose `requiredHostBridge` the live host does not satisfy;
- a host that would break a live remote;
- a build whose manifest declares a different container than the app.

The browser checks the same rules (same parity table) before mounting a remote.

**Roll-forward-only releases.** A release that ships an irreversible backend change is built with
`--roll-forward-only "<reason>"`. `rollback.sh --release` refuses to step back past it without `--force`,
because an older frontend would call endpoints that no longer exist.

> **This release is roll-forward-only.** LeadService's `ConnectToProductCatalogue` migration copies
> product names into each lead, drops the old `Products` table and clears `LeadFieldConfigs`. Take a
> `pg_dump` of `lead_service` before the first deploy; pending approvals from before it must be
> re-submitted.

**Rolling back backend images.** Set the previous `*_TAG` values in `deploy/.env` and run
`docker compose up -d`. Never do this past a migration that changed the schema.

## Maintenance

1. In **Setup → Applications**, set the app to **Maintenance** with a message. This goes through maker-checker if the Applications module is gated.
2. Users then:
   - see the app in the sidebar with a maintenance badge;
   - get the maintenance page when they open it;
   - are not even sent its manifest URL.
3. **Operators can still open it.**
   - Grant the capability **Setup — Applications → MaintenanceBypass** to an operator role. Administrators have it implicitly.
   - Holders open the app normally, under a "you have maintenance access" banner, to verify a fix in production.
   - This is a capability the server checks; it is never inferred from a role name.
4. **Typical fix:**
   1. Maintenance on.
   2. Release the fixed remote with `pnpm release -- --only <key>` and `deploy.sh --frontend-only`.
   3. Verify with a bypass account.
   4. Maintenance off.

   Users never see the broken build again, and nothing else restarts.

> Maintenance hides the app in the browser; the app's API stays up. Gating the API itself
> (503 for non-bypass callers) is a recommended follow-up.

## Housekeeping

`deploy/scripts/gc.sh` (dry run) or `deploy/scripts/gc.sh --apply` removes old build folders.

It keeps everything that is:
- referenced by the last 10 releases;
- live, or superseded within 30 days (open tabs may still need it);
- added within 30 days.

## Rehearse a release on a workstation

`deploy/compose.verify.yml` runs the real stack and scripts locally:
- a throwaway Postgres;
- release folders on a Linux volume, so symlinks and atomic renames are real even on Windows;
- a `deployer` container with bash, jq and the docker CLI.

**Settings:** create `deploy/.env` and `deploy/env/*.env` from the examples with throwaway secrets, `PUBLIC_PORT=8088`,
`COMPOSE_EXTRA_FILE=compose.verify.yml`, `SMOKE_BASE_URL=http://web:8080` (the deployer is on the
private network). `scripts/init-env.sh --domain x.test --mode windows --yes` writes the rest, and the
`edge-test` profile adds a Caddy container in front of nginx, the stand-in for Windows' Caddy.

**On Docker Desktop for Windows**, mount the repository at the path the daemon knows it by:

```bash
R=/run/desktop/mnt/host/c/path/to/OmniConnectt
cd deploy
docker compose -f compose.yml -f compose.verify.yml --profile tools build
docker compose -f compose.yml -f compose.verify.yml up -d --wait db
MSYS_NO_PATHCONV=1 docker compose -f compose.yml -f compose.verify.yml --profile tools \
  run --rm -T -v $R:$R -w $R/deploy deployer bash scripts/deploy.sh ../Frontend/release/<id>.tar.gz
```

The bootstrap Super Admin's one-time password is printed once in `docker compose logs auth` on the
first start of an empty AuthDb. Tear down with `down -v` and delete the rehearsal env files afterwards.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `deploy.sh`: "already published with different content" | The code changed but the version was not bumped. Bump it. |
| Promotion refused: "needs host bridge …" | Release a compatible host first, or relax the remote's range. |
| A service is unhealthy after `up` | `docker compose logs <svc>`. A missing env value is named at startup. |
| ProductsService 500s on every read | Its database holds the pre-rebuild schema. It needs an empty database (see setup). |
| Users report "Failed to fetch dynamically imported module" | A version folder a tab still used was deleted. Don't GC more aggressively than the defaults. |
| Login works, then the session drops on refresh | The refresh cookie is scoped to `/api/auth`. AuthService must stay at the origin's `/api`. |
