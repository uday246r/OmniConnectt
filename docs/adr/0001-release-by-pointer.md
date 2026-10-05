# ADR 0001 — Release micro-frontends by moving a pointer, not by replacing files

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

OmniConnect is a host shell plus remote micro-frontends (Lead Management, Customer 360, Products &
Marketplace), loaded at runtime with Module Federation. The requirements for production were:

1. One public URL. Remotes and services are never exposed on URLs of their own.
2. One deployable release artifact, with the host and every remote kept as separately built apps.
3. A change to one remote must not cause downtime for the host or any other remote, and must not require
   rebuilding the host.
4. Independent versions, an immutable record of each release, and rollback.
5. Per-remote maintenance, with a bypass for authorised operators.

The first plan proposed assembling all builds into one artifact served at stable paths
(`/modules/lead/…`) and redeploying the whole artifact for every change. That meets 1, 2 and 4 but breaks 3.

A browser that loaded Lead's `remoteEntry.js` before a deploy lazy-loads its chunks afterwards. Swapping
the files under a stable path gives that tab either 404s for chunks that no longer exist or a mix of two
builds' code and CSS. A container replacement on top of that is a brief outage for everyone.

## Decision

- **Every build lives in its own immutable, versioned folder:** `/modules/<key>/<version>/` for remotes,
  `/host/<version>/` for the host.
  - Remotes build with `base: './'`. Module Federation resolves `publicPath: "auto"` from the manifest
    URL's own directory, and chunk/CSS URLs from `import.meta.url`, so a build works from any folder.
  - Folders are served `immutable` and are never overwritten. Republishing a version with different
    content is refused, both by the deploy script and by AuthService's release history.
- **Going live is a pointer move.**
  - A remote: its `RemoteApp.ManifestUrl` in AuthDb (the single source of truth for remotes) moves to the
    new folder.
  - The host: an atomic symlink rename makes the new `index.html` the one served at `/`.
  - AuthService records each move in `ReleaseRecords`, invalidates the navigation cache, and pushes a
    "navigation changed" event to open tabs.
- **A tab already running a remote keeps that build.** On next entry it is offered a reload, because
  Module Federation cannot unload a remote.
- **The release artifact is a set of folders plus `release-manifest.json`.** It is one deployable unit
  with one audit record, not one compilation.
- **Compatibility is declared and checked twice.**
  - Each remote declares the host-bridge contract range it needs (`omniconnect.requiredHostBridge`,
    written into its manifest).
  - AuthService refuses to promote an incompatible pair, and the host refuses to mount one. Both use the
    same SemVer rules, held together by a shared parity table.
- **Maintenance bypass is a capability** (`host.settings.applications:MaintenanceBypass`) evaluated by the
  server when building the navigation tree. Callers without it are not sent the manifest URL at all.

## Consequences

**Good**
- Shipping a remote restarts nothing and touches no other app. This was verified in a rehearsal: a
  Lead-only release with every container's start time unchanged.
- Rollback is instant and needs no rebuild.
- "What is running?" is answered by `/release-manifest.json` and the release history.

**Costs**
- Old version folders must be kept for as long as a tab might use them. `gc.sh` keeps the last 10
  releases, anything live or superseded within 30 days, and anything added within 30 days.
- Only the backend's own containers restart on a backend change, but each recreation is a few seconds of
  502s for that one service. Two replicas behind the nginx upstream remove that; it is a follow-up.
- A release with an irreversible migration must be marked roll-forward-only. This one is: LeadService
  drops its `Products` table.
- Maintenance hides an app in the UI; its API stays reachable unless the service also enforces it
  (follow-up).

## Alternatives considered

- **Stable `/modules/<key>/` path with a `current` symlink per remote.** Rejected. Unhashed
  `remoteEntry.js`/`mf-manifest.json` must then be uncacheable, the MF runtime caches manifests per URL
  for the page's life, and a mid-session swap breaks open tabs. It also loses the record of which version
  is live.
- **Each remote on its own origin (the previous Vercel/Render setup).** Rejected by requirement 1. It also
  needs CORS on every remote and a cross-site refresh cookie (`SameSite=None`).
- **One container image containing all builds.** Rejected for remote changes: every deploy replaces the
  frontend server. Images are still used for the four backends.
