#!/usr/bin/env bash
# A lab copy of Zenvi Cloud for experiments, kept apart from production: its
# own storage account, container registry and Container Apps environment in
# the lab resource group, the smallest sizes that render motion blocks, the
# service scaled to zero, every resource tagged. It runs the same
# provision.sh / deploy.sh / render-jobs.sh as production, with lab parameters.
#
#   scripts/azure/lab.sh up      # create what is missing, build HEAD, deploy the service + render job
#   scripts/azure/lab.sh token   # a personal access token for a lab person → ~/.config/zenvi-dev/lab-pat.env
#   scripts/azure/lab.sh url     # the lab's URL
#   scripts/azure/lab.sh down    # delete every lab resource this script made (the group itself stays)
#
# Auth is production's Supabase JWKS (read-only) or a Zenvi token from the lab's
# own tokens table; the backend tools are off (no service secret). Connection
# strings go to ~/.config/zenvi-dev/lab-cloud.env (mode 600) and are never printed.
set -euo pipefail

LAB_RG="${LAB_RG:-zenvi-motion-lab}"
LOCATION="${LOCATION:-eastus}"
# Storage account and registry names: lowercase letters and digits, globally unique.
LAB_NAME="${LAB_NAME:-zenvimotionlabw15}"
LAB_ENV="${LAB_ENV:-zenvi-lab-env}"
LAB_APP="${LAB_APP:-zenvi-cloud-lab}"
LAB_JOB="${LAB_JOB:-zenvi-render-lab}"
LAB_QUEUE="${LAB_QUEUE:-render-jobs}"
LAB_ENV_FILE="${LAB_ENV_FILE:-$HOME/.config/zenvi-dev/lab-cloud.env}"
LAB_PAT_FILE="${LAB_PAT_FILE:-$HOME/.config/zenvi-dev/lab-pat.env}"
LAB_USER="${LAB_USER:-lab-motion-tester}"
TAGS="purpose=zenvi-motion-experiments owner=jashan"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"

die() { echo "lab: $*" >&2; exit 1; }
step() { echo "==> $*"; }

command -v az >/dev/null || die "the Azure CLI (az) is required"
[ "$LAB_RG" != "zenvi-rg" ] || die "zenvi-rg is production; the lab lives elsewhere"
az group show -n "$LAB_RG" -o none 2>/dev/null || die "resource group $LAB_RG does not exist (the lab does not create groups)"

up() {
  step "Storage account $LAB_NAME (Standard_LRS, private)"
  if ! az storage account show -g "$LAB_RG" -n "$LAB_NAME" -o none 2>/dev/null; then
    az storage account create -g "$LAB_RG" -n "$LAB_NAME" -l "$LOCATION" --sku Standard_LRS --kind StorageV2 \
      --min-tls-version TLS1_2 --allow-blob-public-access false --tags $TAGS -o none
  fi
  mkdir -p "$(dirname "$LAB_ENV_FILE")"
  (umask 077 && printf 'AZURE_STORAGE_CONNECTION_STRING=%s\n' \
    "$(az storage account show-connection-string -g "$LAB_RG" -n "$LAB_NAME" --query connectionString -o tsv)" > "$LAB_ENV_FILE")
  # Signed upload links are PUT from the person's browser or CLI.
  az storage cors clear --services b --connection-string "$(sed -n 's/^AZURE_STORAGE_CONNECTION_STRING=//p' "$LAB_ENV_FILE")" -o none
  az storage cors add --services b --methods GET HEAD PUT OPTIONS --origins '*' --allowed-headers '*' --exposed-headers '*' --max-age 3600 \
    --connection-string "$(sed -n 's/^AZURE_STORAGE_CONNECTION_STRING=//p' "$LAB_ENV_FILE")" -o none

  step "Container registry $LAB_NAME (Basic)"
  if ! az acr show -g "$LAB_RG" -n "$LAB_NAME" -o none 2>/dev/null; then
    az acr create -g "$LAB_RG" -n "$LAB_NAME" -l "$LOCATION" --sku Basic --admin-enabled true --tags $TAGS -o none
  fi

  step "Container Apps environment $LAB_ENV (consumption, no log workspace)"
  if ! az containerapp env show -g "$LAB_RG" -n "$LAB_ENV" -o none 2>/dev/null; then
    az containerapp env create -g "$LAB_RG" -n "$LAB_ENV" -l "$LOCATION" --logs-destination none --tags $TAGS -o none
  fi

  local tag
  tag="lab-$(git -C "$ROOT" rev-parse --short=12 HEAD)"
  local common=(RG="$LAB_RG" ENV_NAME="$LAB_ENV" REGISTRY="$LAB_NAME" ENV_FILE="$LAB_ENV_FILE" TAGS="$TAGS")
  # The service: 2 vCPU / 4 GiB (Chrome renders motion blocks in tool calls), scaled to zero.
  env "${common[@]}" APP="$LAB_APP" RENDER_JOB="$LAB_JOB" MIN_REPLICAS=0 MAX_REPLICAS=1 CPU=2 MEMORY=4Gi RENDER_QUEUE="$LAB_QUEUE" \
    "$HERE/deploy.sh" "$tag"
  step "Render job $LAB_JOB (2 vCPU / 4 GiB, at most 2 at once)"
  env "${common[@]}" JOB="$LAB_JOB" QUEUE="$LAB_QUEUE" CPU=2 MEMORY=4Gi MAX_EXECUTIONS=2 TIMEOUT_SECONDS=1800 IMAGE_TAG="$tag" \
    "$HERE/render-jobs.sh"
  step "Lab up: $(url)"
}

url() {
  echo "https://$(az containerapp show -g "$LAB_RG" -n "$LAB_APP" --query properties.configuration.ingress.fqdn -o tsv)"
}

token() {
  [ -r "$LAB_ENV_FILE" ] || die "missing $LAB_ENV_FILE: run lab.sh up first"
  (cd "$ROOT" && ENV_FILE="$LAB_ENV_FILE" npx tsx packages/cloud/scripts/mint-token.ts "$LAB_USER" "$LAB_PAT_FILE")
}

down() {
  step "Deleting the lab's job, app, environment, registry and storage in $LAB_RG"
  az containerapp job delete -g "$LAB_RG" -n "$LAB_JOB" --yes -o none 2>/dev/null || true
  az containerapp delete -g "$LAB_RG" -n "$LAB_APP" --yes -o none 2>/dev/null || true
  az containerapp env delete -g "$LAB_RG" -n "$LAB_ENV" --yes -o none 2>/dev/null || true
  az acr delete -g "$LAB_RG" -n "$LAB_NAME" --yes -o none 2>/dev/null || true
  az storage account delete -g "$LAB_RG" -n "$LAB_NAME" --yes -o none 2>/dev/null || true
  rm -f "$LAB_ENV_FILE" "$LAB_PAT_FILE"
  step "Left in $LAB_RG: $(az resource list -g "$LAB_RG" --query 'length(@)' -o tsv) resource(s)"
}

case "${1:-}" in
  up) up ;;
  token) token ;;
  url) url ;;
  down) down ;;
  *) die "usage: lab.sh up|token|url|down" ;;
esac
