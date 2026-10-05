#!/usr/bin/env bash
# Puts one already-installed remote build in front of users, or reports what is live.
#
#   deploy/scripts/promote.sh lead 1.0.1     # make lead 1.0.1 live (it must already be registered)
#   deploy/scripts/promote.sh --list [lead]  # release history from AuthService
#
# The host and every other remote are untouched: this moves one pointer, and open tabs are told to
# re-read their navigation. AuthService refuses a build the live host cannot run.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

if [[ "${1:-}" == --list ]]; then
  release_api GET "${2:+?key=$2}" | jq -r '.[] | [.key, .version, .status, (.promotedAt // "-"), (.promotedBy // "-")] | @tsv' | column -t
  exit 0
fi

KEY="${1:-}"; VERSION="${2:-}"
[[ -n "$KEY" && -n "$VERSION" ]] || die "Usage: promote.sh <key> <version> | promote.sh --list [key]"
[[ "$KEY" != host ]] || die "The host is switched with rollback.sh <releaseId> or by deploying a release."

release_api POST promote "{\"key\":\"$KEY\",\"version\":\"$VERSION\"}" | jq -r '"Live: \(.key) \(.version)"'
