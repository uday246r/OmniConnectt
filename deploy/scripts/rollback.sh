#!/usr/bin/env bash
# Rolls the frontend back — instantly, without rebuilding anything, because every earlier build is
# still on disk.
#
#   deploy/scripts/rollback.sh lead              # one remote back to the build that was live before
#   deploy/scripts/rollback.sh --release <id>    # the whole frontend back to an earlier release
#   deploy/scripts/rollback.sh --release <id> --force   # past a roll-forward-only release (see below)
#
# Roll-forward-only: a release whose backend change cannot be undone (a destructive migration) is
# marked so in its release-manifest.json. Putting an older frontend in front of the newer backend would
# call endpoints that no longer exist, so stepping back past it is refused unless forced.
#
# This moves FRONTEND pointers only. Backend images are rolled back by setting the previous tags in
# deploy/.env and running `podman compose up -d` (or docker compose) — and never past a migration that changed the schema.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

if [[ "${1:-}" != --release ]]; then
  KEY="${1:-}"
  [[ -n "$KEY" && "$KEY" != host ]] || die "Usage: rollback.sh <remote-key> | rollback.sh --release <releaseId> [--force]"
  release_api POST rollback "{\"key\":\"$KEY\"}" | jq -r '"Live again: \(.key) \(.version)"'
  exit 0
fi

TARGET="${2:-}"; FORCE="${3:-}"
[[ -n "$TARGET" && -f "$RELEASE_ROOT/releases/$TARGET/release-manifest.json" ]] || die "Release $TARGET is not installed here. Installed: $(ls "$RELEASE_ROOT/releases" | tr '\n' ' ')"
CURRENT="$(current_release)"
[[ "$TARGET" != "$CURRENT" ]] || die "$TARGET is already live."

# Refuse to step back past a roll-forward-only release, unless forced.
for release in $(ls -1 "$RELEASE_ROOT/releases" | sort -r); do
  [[ "$release" == "$TARGET" ]] && break
  reason="$(jq -r '.rollForwardOnly.reason // empty' "$RELEASE_ROOT/releases/$release/release-manifest.json")"
  if [[ -n "$reason" && "$FORCE" != --force ]]; then
    die "Release $release is roll-forward-only ($reason). Rolling back past it needs --force — and a matching backend."
  fi
done

MANIFEST="$RELEASE_ROOT/releases/$TARGET/release-manifest.json"
log "Rolling back to $TARGET"
for key in $(jq -r '.remotes | keys[]' "$MANIFEST"); do
  version="$(jq -r ".remotes[\"$key\"].version" "$MANIFEST")"
  release_api POST promote "{\"key\":\"$key\",\"version\":\"$version\"}" >/dev/null && ok "$key → $version"
done
release_api POST promote "{\"key\":\"host\",\"version\":\"$(jq -r .host.version "$MANIFEST")\"}" >/dev/null
point_current_at "$TARGET"
ok "Host → $(jq -r .host.version "$MANIFEST")"

"$(dirname "$0")/smoke.sh" "$TARGET"
