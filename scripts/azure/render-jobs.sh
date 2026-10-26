#!/usr/bin/env bash
# Render workers for Zenvi Cloud: an Azure Container Apps job that renders one
# render job per message on a storage queue, with its own CPUs and memory
# (packages/cloud/src/render-job.ts), so renders neither slow nor endanger the
# container that answers requests. Idempotent: it creates what is missing and
# brings the job up to date.
#
#   IMAGE_TAG=<tag> scripts/azure/render-jobs.sh    # create or update the job (deploy.sh keeps its image current)
#   az containerapp update -g zenvi-rg -n zenvi-cloud --set-env-vars ZENVI_RENDER_QUEUE=render-jobs
#
# The second line turns it on: the service then posts each new render on the
# queue, and renders in its own process only what no worker claims within
# five minutes. To turn it off, remove the variable
# (`--remove-env-vars ZENVI_RENDER_QUEUE`); the job then sits idle.
#
# Cost: consumption plan, billed only while an execution runs (CPU x seconds,
# memory x seconds); no executions, no charge.
#
# Needs: `az login` and ~/.config/zenvi-dev/cloud.env with
# AZURE_STORAGE_CONNECTION_STRING=… (as provision.sh; never printed). Touches
# only the queue and the job `zenvi-render` in environment `zenvi-env`.
set -euo pipefail

RG="${RG:-zenvi-rg}"
ENV_NAME="${ENV_NAME:-zenvi-env}"
JOB="${JOB:-zenvi-render}"
REGISTRY="${REGISTRY:-zenviregistry}"
QUEUE="${QUEUE:-render-jobs}"
BLOB_CONTAINER="${BLOB_CONTAINER:-zenvi}"
ENV_FILE="${ENV_FILE:-$HOME/.config/zenvi-dev/cloud.env}"
CPU="${CPU:-4}"
MEMORY="${MEMORY:-8Gi}"
MAX_EXECUTIONS="${MAX_EXECUTIONS:-4}"
# Longer than any render the service accepts; a stopped execution's job is re-queued by the service.
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-2700}"
IMAGE_TAG="${IMAGE_TAG:-}"
# Space-separated key=value, applied when the job is created (scripts/azure/lab.sh).
TAGS="${TAGS:-}"
SECRET_NAME="azure-storage-connection-string"

die() { echo "render-jobs: $*" >&2; exit 1; }
step() { echo "==> $*"; }

command -v az >/dev/null || die "the Azure CLI (az) is required"
[ -r "$ENV_FILE" ] || die "missing $ENV_FILE"
# The value contains ';' — read it verbatim instead of sourcing the file.
CONN="$(sed -n 's/^AZURE_STORAGE_CONNECTION_STRING=//p' "$ENV_FILE" | head -n 1)"
[ -n "$CONN" ] || die "AZURE_STORAGE_CONNECTION_STRING is not set in $ENV_FILE"
ACCOUNT="$(printf '%s' "$CONN" | tr ';' '\n' | sed -n 's/^AccountName=//p')"
[ -n "$ACCOUNT" ] || die "no AccountName in the storage connection string"

step "Storage queue '$QUEUE'"
az storage queue create --name "$QUEUE" --connection-string "$CONN" -o none

ACR_SERVER="$(az acr show -n "$REGISTRY" --query loginServer -o tsv)"
ENV_VARS=(
  "AZURE_STORAGE_CONNECTION_STRING=secretref:$SECRET_NAME"
  "AZURE_BLOB_CONTAINER=$BLOB_CONTAINER"
  "STORAGE=azure"
  "ZENVI_RENDER_QUEUE=$QUEUE"
  "RENDER_TMP_DIR=/tmp"
  # The az CLI reads a dash-dash argument as its own option, so this one goes in through the environment.
  "NODE_OPTIONS=--enable-source-maps"
  "NODE_ENV=production"
  "LOG_LEVEL=info"
)
[ -n "$IMAGE_TAG" ] && ENV_VARS+=("ZENVI_CLOUD_VERSION=$IMAGE_TAG")
TAG_ARGS=()
# shellcheck disable=SC2206 # space-separated key=value pairs, by design
[ -n "$TAGS" ] && TAG_ARGS=(--tags $TAGS)

if ! az containerapp job show -g "$RG" -n "$JOB" -o none 2>/dev/null; then
  [ -n "$IMAGE_TAG" ] || die "IMAGE_TAG is required to create $JOB (an image built by scripts/azure/deploy.sh)"
  step "Creating job $JOB ($ACR_SERVER/zenvi-cloud:$IMAGE_TAG, $CPU vCPU, $MEMORY)"
  ACR_USER="$(az acr credential show -n "$REGISTRY" --query username -o tsv)"
  ACR_PASS="$(az acr credential show -n "$REGISTRY" --query 'passwords[0].value' -o tsv)"
  az containerapp job create -g "$RG" -n "$JOB" --environment "$ENV_NAME" \
    --trigger-type Event \
    --replica-timeout "$TIMEOUT_SECONDS" --replica-retry-limit 0 --replica-completion-count 1 --parallelism 1 \
    --min-executions 0 --max-executions "$MAX_EXECUTIONS" --polling-interval 5 \
    --scale-rule-name render-queue --scale-rule-type azure-queue \
    --scale-rule-metadata "accountName=$ACCOUNT" "queueName=$QUEUE" "queueLength=1" \
    --scale-rule-auth "connection=$SECRET_NAME" \
    --image "$ACR_SERVER/zenvi-cloud:$IMAGE_TAG" \
    --registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
    --cpu "$CPU" --memory "$MEMORY" \
    --secrets "$SECRET_NAME=$CONN" \
    --env-vars "${ENV_VARS[@]}" \
    --args node dist/render-job.mjs \
    ${TAG_ARGS[@]+"${TAG_ARGS[@]}"} \
    -o none
else
  step "Updating job $JOB"
  az containerapp job secret set -g "$RG" -n "$JOB" --secrets "$SECRET_NAME=$CONN" -o none
  IMAGE_ARGS=()
  [ -n "$IMAGE_TAG" ] && IMAGE_ARGS=(--image "$ACR_SERVER/zenvi-cloud:$IMAGE_TAG")
  az containerapp job update -g "$RG" -n "$JOB" ${IMAGE_ARGS[@]+"${IMAGE_ARGS[@]}"} \
    --cpu "$CPU" --memory "$MEMORY" \
    --replica-timeout "$TIMEOUT_SECONDS" --max-executions "$MAX_EXECUTIONS" \
    --set-env-vars "${ENV_VARS[@]}" \
    -o none
fi
step "Done: job $JOB renders messages on queue $QUEUE (set ZENVI_RENDER_QUEUE=$QUEUE on the service to use it)"
