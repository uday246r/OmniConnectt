#!/usr/bin/env bash
# Checks the public edge after a deploy: what users get, what they must NOT get, and the cache policy.
#   deploy/scripts/smoke.sh [<releaseId>]
set -euo pipefail
source "$(dirname "$0")/lib.sh"

BASE="${SMOKE_BASE_URL:-http://127.0.0.1:$PUBLIC_PORT}"
EXPECTED_RELEASE="${1:-$(current_release)}"
FAILURES=0

check() {   # check <description> <expected-status> <path> [header-substring]
  local what="$1" want="$2" path="$3" header="${4:-}" out status
  out="$(curl -sS -o /dev/null -D - "$BASE$path" || true)"
  status="$(printf '%s' "$out" | head -1 | awk '{print $2}')"
  if [[ "$status" != "$want" ]]; then
    warn "$what: $path → $status (expected $want)"; FAILURES=$((FAILURES + 1)); return
  fi
  if [[ -n "$header" ]] && ! printf '%s' "$out" | grep -qi "$header"; then
    warn "$what: $path is missing '$header'"; FAILURES=$((FAILURES + 1)); return
  fi
  ok "$what"
}

check "Edge is up"                         200 /healthz
check "Host shell, never cached"           200 /                          "cache-control: no-cache"
check "Deep link served by the shell"      200 /apps/lead/view-lead       "cache-control: no-cache"
check "Security headers present"           200 /                          "x-content-type-options: nosniff"
check "AuthService reachable"              200 /api/auth/sso-config
check "LeadService reachable"              200 /api/lead-service/health/live
check "Customer360Service reachable"       200 /api/customer360-service/health/live
check "ProductsService reachable"          200 /api/products-service/health/live

check "Internal approval replay hidden"    404 /api/lead-service/internal/approvals/apply
check "Internal catalogue hidden"          404 /api/products-service/internal/catalog/categories
check "Capability discovery hidden"        404 /api/customer360-service/permissions
check "AuthService internal API hidden"    200 /internal/releases     "cache-control: no-cache"   # the SPA, not AuthService
check "Missing chunk is a real 404"        404 /host/0.0.0-missing/assets/x.js

live="$(curl -sS "$BASE/release-manifest.json" | jq -r .releaseVersion)"
if [[ -n "$EXPECTED_RELEASE" && "$live" != "$EXPECTED_RELEASE" ]]; then
  warn "release-manifest.json says $live, expected $EXPECTED_RELEASE"; FAILURES=$((FAILURES + 1))
else
  ok "Live release is $live"
fi

manifest="$(curl -sS "$BASE/release-manifest.json")"
host_path="$(jq -r .host.path <<<"$manifest")"
check "Host build is immutable"            200 "${host_path}favicon.svg"  "immutable"
for key in $(jq -r '.remotes | keys[]' <<<"$manifest"); do
  url="$(jq -r ".remotes[\"$key\"].manifestUrl" <<<"$manifest")"
  check "$key manifest served, immutable"   200 "$url"                    "immutable"
  check "$key has no standalone page"       404 "${url%mf-manifest.json}index.html"
done

if (( FAILURES > 0 )); then
  die "$FAILURES smoke check(s) failed."
fi
ok "All smoke checks passed."
