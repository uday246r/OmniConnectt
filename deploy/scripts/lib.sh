#!/usr/bin/env bash
# Shared helpers for the OmniConnect deployment scripts. Sourced, never run.
#
# Requirements on the server: bash, tar, sha256sum, jq, curl, and a container engine: rootful Podman
# with `podman compose` (docker-compose as its provider, podman.socket enabled) — the production setup —
# or Docker with compose v2. CONTAINER_ENGINE=podman|docker in deploy/.env chooses; unset, Podman is
# used when installed.

set -euo pipefail

ORIG_PWD="$PWD"
CALLER="$(cd "$(dirname "${BASH_SOURCE[1]:-$0}")" && pwd)/$(basename "${BASH_SOURCE[1]:-$0}")"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEPLOY_DIR"

[[ -f .env ]] || { echo "deploy/.env is missing — copy deploy/.env.example and fill it in." >&2; exit 1; }
set -a
# shellcheck disable=SC1091
source .env
set +a

: "${RELEASE_ROOT:=/srv/omniconnect}"
: "${PUBLIC_PORT:=80}"
: "${RELEASE_ACTOR:=${GITHUB_RUN_ID:+github-actions run $GITHUB_RUN_ID}}"
: "${RELEASE_ACTOR:=$(whoami)@$(hostname)}"

if [[ -z "${CONTAINER_ENGINE:-}" ]]; then
  if command -v podman >/dev/null; then CONTAINER_ENGINE=podman; else CONTAINER_ENGINE=docker; fi
fi

# The platform runs under ROOTFUL Podman: its containers start at boot (podman-restart.service) and its
# port forwarding keeps the client address the nginx edge relies on. A rootless `podman` would quietly
# look at a different, empty container store, so re-run this script as root instead.
if [[ "$CONTAINER_ENGINE" == podman && "$EUID" -ne 0 ]]; then
  cd "$ORIG_PWD"
  exec sudo --preserve-env=RELEASE_ACTOR,GITHUB_RUN_ID,SMOKE_BASE_URL,BACKUP_ROOT,KEEP_DAYS,KEEP_RELEASES bash "$CALLER" "$@"
fi

COMPOSE=("$CONTAINER_ENGINE" compose --env-file "$DEPLOY_DIR/.env" -f "$DEPLOY_DIR/compose.yml")
# An extra compose file layered on top, e.g. compose.verify.yml for a workstation rehearsal.
if [[ -n "${COMPOSE_EXTRA_FILE:-}" ]]; then COMPOSE+=(-f "$DEPLOY_DIR/$COMPOSE_EXTRA_FILE"); fi

log()  { printf '\033[1;34m▶\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m⚠\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✖\033[0m %s\n' "$*" >&2; exit 1; }

for tool in "$CONTAINER_ENGINE" tar sha256sum jq curl; do
  command -v "$tool" >/dev/null || die "$tool is required on the deployment host."
done
"${COMPOSE[@]}" version >/dev/null 2>&1   || die "'$CONTAINER_ENGINE compose' does not work. Podman: install docker-compose and run 'systemctl enable --now podman.socket' (docs/DEPLOY-WINDOWS-SERVER-2022.md, Part 5)."

# Where each remote's capability endpoint is, inside the compose network — used only when an app is
# installed for the first time. Must match RemoteApps__BuiltIn__* in compose.yml.
permissions_source_for() {
  case "$1" in
    lead)        echo "http://lead:8080/api/lead-service/permissions" ;;
    customer360) echo "http://c360:8080/permissions" ;;
    products)    echo "http://products:8080/permissions" ;;
    *)           echo "" ;;
  esac
}

# Calls AuthService's /internal/releases API from inside the private network (it is never exposed
# through nginx). Prints the JSON response; fails with the server's own message on any non-2xx.
#   release_api POST promote '{"key":"lead","version":"1.0.1"}'
release_api() {
  local method="$1" path="$2" body="${3:-}"
  [[ -n "${RELEASE_AGENT_KEY:-}" ]] || die "RELEASE_AGENT_KEY is not set in deploy/.env."
  local args=(-sS --fail-with-body -X "$method"
    -H "X-Internal-Api-Key: $RELEASE_AGENT_KEY"
    -H "X-Release-Actor: $RELEASE_ACTOR"
    -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(--data "$body")
  "${COMPOSE[@]}" --profile tools run --rm -T release-agent "${args[@]}" "http://auth:8080/internal/releases${path:+/$path}"
}

# The release the `current` pointer names, or empty on a fresh host.
current_release() {
  [[ -L "$RELEASE_ROOT/current" ]] && basename "$(readlink "$RELEASE_ROOT/current")" || true
}

# Atomically points `current` at a release directory: a new symlink renamed over the old one. A plain
# `ln -sfn` unlinks then creates, leaving a moment in which nginx finds no index.html at all.
point_current_at() {
  local release_id="$1"
  [[ -f "$RELEASE_ROOT/releases/$release_id/index.html" ]] || die "Release $release_id is not installed on this host."
  ln -s "releases/$release_id" "$RELEASE_ROOT/.current.tmp"
  mv -T "$RELEASE_ROOT/.current.tmp" "$RELEASE_ROOT/current"
}
