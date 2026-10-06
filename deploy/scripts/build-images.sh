#!/usr/bin/env bash
# Builds the four backend images with the container engine's own builder.
#
#   deploy/scripts/build-images.sh              # all four
#   deploy/scripts/build-images.sh lead auth    # just these
#
# The engine's own `build`, not `compose build`: under Podman, compose would build through Podman's
# Docker-compatible socket, the least travelled path; `podman build` is Podman's native builder.
# `--format docker` keeps each Dockerfile's HEALTHCHECK, which Podman's default OCI format drops
# (compose.yml declares the health checks too, so either way the platform has them).
#
# Tags are <IMAGE_REGISTRY>/<service>:<TAG> from deploy/.env — exactly the names compose.yml runs.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

BACKEND="$(cd "$DEPLOY_DIR/../Backend" && pwd)"
REGISTRY="${IMAGE_REGISTRY:-localhost/omniconnect}"
declare -A DOCKERFILE=([auth]=AuthService/Dockerfile [lead]=LeadService/Dockerfile [customer360]=Customer360Service/Dockerfile [products]=ProductsService/Dockerfile)
declare -A TAG=([auth]="${AUTH_TAG:-local}" [lead]="${LEAD_TAG:-local}" [customer360]="${C360_TAG:-local}" [products]="${PRODUCTS_TAG:-local}")

FORMAT=()
[[ "$CONTAINER_ENGINE" == podman ]] && FORMAT=(--format docker)

TARGETS=("$@")
[[ ${#TARGETS[@]} -gt 0 ]] || TARGETS=(auth lead customer360 products)

for image in "${TARGETS[@]}"; do
  [[ -n "${DOCKERFILE[$image]:-}" ]] || die "Unknown image '$image' (auth, lead, customer360, products)."
  ref="$REGISTRY/$image:${TAG[$image]}"
  log "Building $ref"
  "$CONTAINER_ENGINE" build "${FORMAT[@]}" -f "$BACKEND/${DOCKERFILE[$image]}" -t "$ref" "$BACKEND" \
    || die "Building $image failed (see the output above)."
  ok "$ref"
done
