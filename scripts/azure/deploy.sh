#!/usr/bin/env bash
# Build the Zenvi Cloud image in Azure Container Registry and roll the
# container app to it.
#
#   scripts/azure/deploy.sh            # tag = short commit sha of HEAD
#   scripts/azure/deploy.sh my-tag
#
# The image is built from the COMMITTED tree (git archive of HEAD), not the
# working directory, so a deploy is reproducible from its tag and never picks
# up half-finished files. Only the paths the Dockerfile needs are uploaded
# (no node_modules), which keeps `az acr build` fast. If the app does not
# exist yet, provision.sh creates it with this image.
set -euo pipefail

RG="${RG:-zenvi-rg}"
APP="${APP:-zenvi-cloud}"
REGISTRY="${REGISTRY:-zenviregistry}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
TAG="${1:-$(git -C "$ROOT" rev-parse --short=12 HEAD)}"

die() { echo "deploy: $*" >&2; exit 1; }
step() { echo "==> $*"; }

command -v az >/dev/null || die "the Azure CLI (az) is required"
[[ "$TAG" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || die "invalid tag: $TAG"

CTX="$(mktemp -d "${TMPDIR:-/tmp}/zenvi-cloud-build.XXXXXX")"
trap 'rm -rf "$CTX"' EXIT

step "Staging the committed tree ($(git -C "$ROOT" rev-parse --short HEAD)) for the build"
MANIFESTS=()
while IFS= read -r manifest; do MANIFESTS+=("$manifest"); done < <(git -C "$ROOT" ls-files -- 'packages/*/package.json' 'apps/*/package.json')
git -C "$ROOT" archive HEAD package.json package-lock.json tsconfig.base.json \
  packages/engine packages/render-node packages/cloud "${MANIFESTS[@]}" | tar -x -C "$CTX"

step "Building $REGISTRY.azurecr.io/zenvi-cloud:$TAG in ACR"
az acr build -r "$REGISTRY" -t "zenvi-cloud:$TAG" -f packages/cloud/Dockerfile "$CTX"

if az containerapp show -g "$RG" -n "$APP" -o none 2>/dev/null; then
  step "Rolling $APP to zenvi-cloud:$TAG"
  ACR_SERVER="$(az acr show -n "$REGISTRY" --query loginServer -o tsv)"
  az containerapp update -g "$RG" -n "$APP" --image "$ACR_SERVER/zenvi-cloud:$TAG" \
    --set-env-vars "ZENVI_CLOUD_VERSION=$TAG" -o none
else
  step "$APP does not exist yet: provisioning it"
  IMAGE_TAG="$TAG" "$HERE/provision.sh"
fi

FQDN="$(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.ingress.fqdn -o tsv)"
step "Waiting for https://$FQDN/health to report version $TAG"
for _ in $(seq 1 60); do
  if curl -fsS --max-time 10 "https://$FQDN/health" 2>/dev/null | grep -q "\"version\":\"$TAG\""; then
    curl -fsS --max-time 10 "https://$FQDN/health"
    echo
    step "Deployed $TAG"
    exit 0
  fi
  sleep 5
done
die "the new revision did not become healthy in 5 minutes; check: az containerapp logs show -g $RG -n $APP --tail 100"
