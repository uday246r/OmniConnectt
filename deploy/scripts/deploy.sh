#!/usr/bin/env bash
# Deploys one frontend release (built by `pnpm release`) and, unless told otherwise, the backend images
# named in deploy/.env.
#
#   deploy/scripts/deploy.sh release/2026.10.05-abc123.tar.gz
#   deploy/scripts/deploy.sh release/2026.10.05-abc123.tar.gz --frontend-only
#
# What it does, in order — and why nothing users are loading is touched until step 5:
#
#   1. Verify the archive's checksum.
#   2. ADD the release's version folders under $RELEASE_ROOT. A version already present must have
#      identical content (a version names one build, forever); a changed one aborts the deploy.
#   3. Backend: run each service's migrations once (`--migrate-only`, single writer, a failure stops
#      here), then `up -d --wait` — only services whose image changed are recreated.
#   4. Register every build with AuthService (checks each one is really on the web server and is the
#      app it claims to be).
#   5. Promote: remotes the live host can run, then the host (an atomic swap of `current`), then any
#      remote that needed the new host. Each promotion is checked for host-bridge compatibility by
#      AuthService before it happens.
#   6. Smoke-test the public edge. If anything after step 5 fails, every pointer moved by this run is
#      moved back.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

ARCHIVE="${1:-}"; shift || true
FRONTEND_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --frontend-only) FRONTEND_ONLY=true ;;
    *) die "Unknown option $arg" ;;
  esac
done
[[ -f "$ARCHIVE" ]] || die "Usage: deploy.sh <release.tar.gz> [--frontend-only]"

# ── 1. Integrity ─────────────────────────────────────────────────────────────
log "Verifying $(basename "$ARCHIVE")"
[[ -f "$ARCHIVE.sha256" ]] || die "Missing $ARCHIVE.sha256."
( cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256" >/dev/null ) || die "Checksum mismatch — the archive is corrupt or was altered."

mkdir -p "$RELEASE_ROOT"/{host,modules,releases,.checksums}
STAGING="$(mktemp -d "$RELEASE_ROOT/.staging.XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT
tar -xzf "$ARCHIVE" -C "$STAGING"

MANIFEST="$STAGING/release-manifest.json"
RELEASE_ID="$(jq -r .releaseVersion "$MANIFEST")"
HOST_VERSION="$(jq -r .host.version "$MANIFEST")"
BRIDGE_VERSION="$(jq -r .host.bridgeVersion "$MANIFEST")"
mapfile -t REMOTE_KEYS < <(jq -r '.remotes | keys[]' "$MANIFEST")
log "Release $RELEASE_ID — host $HOST_VERSION (bridge $BRIDGE_VERSION), remotes: ${REMOTE_KEYS[*]}"

# ── 2. Add version folders (never overwrite) ────────────────────────────────
install_folder() {
  local rel="$1" sha="$2"          # rel e.g. modules/lead/1.0.1
  local marker="$RELEASE_ROOT/.checksums/${rel//\//__}"
  if [[ -d "$RELEASE_ROOT/$rel" ]]; then
    [[ -f "$marker" && "$(cat "$marker")" == "$sha" ]] \
      || die "$rel is already published with different content. Bump its version and build a new release."
    ok "$rel already present (identical)"
    return
  fi
  mkdir -p "$(dirname "$RELEASE_ROOT/$rel")"
  mv "$STAGING/$rel" "$RELEASE_ROOT/$rel"   # same filesystem: an atomic rename
  echo "$sha" > "$marker"
  ok "$rel added"
}

install_folder "host/$HOST_VERSION" "$(jq -r .host.sha256 "$MANIFEST")"
for key in "${REMOTE_KEYS[@]}"; do
  install_folder "modules/$key/$(jq -r ".remotes[\"$key\"].version" "$MANIFEST")" "$(jq -r ".remotes[\"$key\"].sha256" "$MANIFEST")"
done

RELEASE_DIR="$RELEASE_ROOT/releases/$RELEASE_ID"
mkdir -p "$RELEASE_DIR"
cp "$MANIFEST" "$RELEASE_DIR/release-manifest.json"
cp "$RELEASE_ROOT/host/$HOST_VERSION/index.html" "$RELEASE_DIR/index.html"

# ── 3. Backend ───────────────────────────────────────────────────────────────
if [[ "$FRONTEND_ONLY" == false ]]; then
  log "Backend: pulling images"
  "${COMPOSE[@]}" pull --quiet auth lead c360 products || warn "Pull failed — using local images (built on this host)."

  # PostgreSQL on this machine (COMPOSE_PROFILES=localdb): it must be up before anything migrates.
  if [[ ",${COMPOSE_PROFILES:-}," == *",localdb,"* ]]; then
    log "Database: starting the local PostgreSQL"
    "${COMPOSE[@]}" up -d --wait --wait-timeout 120 db || die "The local PostgreSQL did not become healthy."
  fi

  for svc in auth lead c360 products; do
    log "Migrating $svc (single writer)"
    "${COMPOSE[@]}" run --rm -T --no-deps "$svc" --migrate-only || die "Migrations for $svc failed. Nothing was switched; users are unaffected."
  done

  log "Backend: starting (only changed services are recreated)"
  "${COMPOSE[@]}" up -d --wait --wait-timeout 180 auth lead c360 products web || die "A service did not become healthy."
else
  "${COMPOSE[@]}" up -d --wait --wait-timeout 120 web >/dev/null
fi

# ── 4. Register builds ───────────────────────────────────────────────────────
for key in "${REMOTE_KEYS[@]}"; do
  body="$(jq -c --arg key "$key" --arg rid "$RELEASE_ID" --arg perms "$(permissions_source_for "$key")" '
    .remotes[$key] as $r | {
      key: $key, version: $r.version, checksum: $r.sha256, releaseId: $rid,
      displayName: $r.displayName, iconKey: $r.iconKey, sidebarOrder: $r.sidebarOrder,
      permissionsSourceUrl: (if $perms == "" then null else $perms end)
    }' "$MANIFEST")"
  release_api POST register "$body" >/dev/null || die "Registering $key failed."
  ok "Registered $key $(jq -r ".remotes[\"$key\"].version" "$MANIFEST")"
done
release_api POST register "$(jq -nc --arg v "$HOST_VERSION" --arg b "$BRIDGE_VERSION" --arg rid "$RELEASE_ID" --arg sha "$(jq -r .host.sha256 "$MANIFEST")" \
  '{key:"host", version:$v, bridgeVersion:$b, releaseId:$rid, checksum:$sha}')" >/dev/null || die "Registering the host failed."
ok "Registered host $HOST_VERSION"

# ── 5. Promote (and undo on failure) ─────────────────────────────────────────
PREVIOUS_RELEASE="$(current_release)"
PROMOTED=()
POINTER_MOVED=false

undo() {
  warn "Rolling back the pointers this deploy moved."
  if [[ "$POINTER_MOVED" == true && -n "$PREVIOUS_RELEASE" ]]; then
    point_current_at "$PREVIOUS_RELEASE" && ok "index.html back to $PREVIOUS_RELEASE"
  fi
  for key in "${PROMOTED[@]}"; do
    if [[ "$key" == host ]]; then
      release_api POST rollback '{"key":"host"}' >/dev/null || warn "Host rollback in AuthService failed — check /internal/releases."
    else
      release_api POST rollback "{\"key\":\"$key\"}" >/dev/null || warn "Rollback of $key failed — check /internal/releases."
    fi
  done
}
on_exit() {
  local rc=$?
  if [[ $rc -ne 0 && ( ${#PROMOTED[@]} -gt 0 || "$POINTER_MOVED" == true ) ]]; then undo; fi
  rm -rf "$STAGING"
  exit "$rc"
}
trap on_exit EXIT

live_version() {   # the version AuthService has live for a key, or empty
  release_api GET "?key=$1" | jq -r '.[] | select(.status == "Live") | .version' | head -1
}

promote_remote() {
  local key="$1" version
  version="$(jq -r ".remotes[\"$key\"].version" "$MANIFEST")"
  # Already live (an unchanged remote, or one just installed for the first time): nothing to move,
  # and nothing for a failure later in this run to move back.
  if [[ "$(live_version "$key")" == "$version" ]]; then ok "Unchanged: $key $version"; return 0; fi
  if release_api POST promote "{\"key\":\"$key\",\"version\":\"$version\"}" >/dev/null 2>"$STAGING/promote-$key.err"; then
    PROMOTED+=("$key"); ok "Live: $key $version"; return 0
  fi
  return 1
}

DEFERRED=()
for key in "${REMOTE_KEYS[@]}"; do
  promote_remote "$key" || DEFERRED+=("$key")
done

HOST_WAS_LIVE="$(live_version host)"
release_api POST promote "{\"key\":\"host\",\"version\":\"$HOST_VERSION\"}" >/dev/null || die "AuthService refused the host $HOST_VERSION."
point_current_at "$RELEASE_ID"
POINTER_MOVED=true
# The index.html pointer always moves to this release; the host's release record only if it changed.
[[ "$HOST_WAS_LIVE" == "$HOST_VERSION" ]] || PROMOTED+=(host)
ok "Live: host $HOST_VERSION"

for key in "${DEFERRED[@]}"; do
  promote_remote "$key" || { cat "$STAGING/promote-$key.err" >&2; die "AuthService refused $key."; }
done

# ── 6. Smoke test ────────────────────────────────────────────────────────────
"$(dirname "$0")/smoke.sh" "$RELEASE_ID" || die "Smoke test failed."

PROMOTED=(); POINTER_MOVED=false   # success: nothing to undo
ok "Release $RELEASE_ID is live."
