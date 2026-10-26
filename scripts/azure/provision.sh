#!/usr/bin/env bash
# Provision Zenvi Cloud on Azure Container Apps. Idempotent: safe to re-run;
# it creates what is missing and brings the app's configuration up to date.
#
#   IMAGE_TAG=<tag> scripts/azure/provision.sh     # first run (creates the app)
#   scripts/azure/provision.sh                     # later runs (config only)
#
# Needs: `az login` on subscription "Azure subscription 1", and
# ~/.config/zenvi-dev/cloud.env with AZURE_STORAGE_CONNECTION_STRING=… (the
# storage account already exists; this script never prints the secret).
# Optional lines there turn on the backend tools (docs/CONNECTORS.md §8):
# ZENVI_BACKEND_SERVICE_SECRET=… (preferred) or SUPABASE_SERVICE_ROLE_KEY=….
# Switching to the shared secret leaves the old variable on the app; remove it
# with `az containerapp update -g zenvi-rg -n zenvi-cloud --remove-env-vars SUPABASE_SERVICE_ROLE_KEY`.
#
# Touches only: blob container + tables in the storage account, and the
# container app `zenvi-cloud` in environment `zenvi-env`. Other apps in the
# environment are left alone.
#
# Sizing and the rest default to production's; scripts/azure/lab.sh sets them
# for a lab copy: MIN_REPLICAS, MAX_REPLICAS, CPU, MEMORY, TAGS (space-separated
# key=value, applied when the app is created) and RENDER_QUEUE (hand renders to
# the render job, render-jobs.sh).
set -euo pipefail

RG="${RG:-zenvi-rg}"
ENV_NAME="${ENV_NAME:-zenvi-env}"
APP="${APP:-zenvi-cloud}"
REGISTRY="${REGISTRY:-zenviregistry}"
BLOB_CONTAINER="${BLOB_CONTAINER:-zenvi}"
ENV_FILE="${ENV_FILE:-$HOME/.config/zenvi-dev/cloud.env}"
EDITOR_URL="${ZENVI_EDITOR_URL:-https://zenvi.pro/editor}"
SUPABASE="${SUPABASE_URL:-https://xktarhzbrdnxkaovtdxj.supabase.co}"
# Publishable client key (same value the CLI ships). Not a secret.
ANON="${SUPABASE_ANON_KEY:-sb_publishable_2-FCBkJ96Ss35jqL9krVEQ_otR5iGmA}"
BACKEND="${ZENVI_BACKEND_URL:-https://api.zenvi.pro}"
CORS="${CORS_ORIGINS:-https://zenvi.pro,https://www.zenvi.pro,https://*.vercel.app,http://localhost:*,http://127.0.0.1:*}"
ALIASES="${PUBLIC_BASE_URL_ALIASES:-}"
MCP_ALIASES="${MCP_URL_ALIASES:-https://zenvi.pro/plugin}"
IMAGE_TAG="${IMAGE_TAG:-}"
MIN_REPLICAS="${MIN_REPLICAS:-1}"
MAX_REPLICAS="${MAX_REPLICAS:-1}"
CPU="${CPU:-1}"
MEMORY="${MEMORY:-2Gi}"
TAGS="${TAGS:-}"
RENDER_QUEUE="${RENDER_QUEUE:-}"
SECRET_NAME="azure-storage-connection-string"

die() { echo "provision: $*" >&2; exit 1; }
step() { echo "==> $*"; }

command -v az >/dev/null || die "the Azure CLI (az) is required"
[ -r "$ENV_FILE" ] || die "missing $ENV_FILE"
# The value contains ';' — read it verbatim instead of sourcing the file.
CONN="$(sed -n 's/^AZURE_STORAGE_CONNECTION_STRING=//p' "$ENV_FILE" | head -n 1)"
[ -n "$CONN" ] || die "AZURE_STORAGE_CONNECTION_STRING is not set in $ENV_FILE"
SERVICE_SECRET="$(sed -n 's/^ZENVI_BACKEND_SERVICE_SECRET=//p' "$ENV_FILE" | head -n 1)"
SERVICE_ROLE="$(sed -n 's/^SUPABASE_SERVICE_ROLE_KEY=//p' "$ENV_FILE" | head -n 1)"
# Stock search without the backend (a lab or self-hosted copy): the providers' own keys.
PEXELS_KEY="$(sed -n 's/^PEXELS_API_KEY=//p' "$ENV_FILE" | head -n 1)"
FREESOUND_KEY="$(sed -n 's/^FREESOUND_API_KEY=//p' "$ENV_FILE" | head -n 1)"

step "Storage: blob container '$BLOB_CONTAINER' (private) and tables"
az storage container create --name "$BLOB_CONTAINER" --public-access off --connection-string "$CONN" -o none
for table in tokens oauthclients oauthcodes devicecodes renders backendsessions generations; do
  az storage table create --name "$table" --connection-string "$CONN" -o none
done

DOMAIN="$(az containerapp env show -g "$RG" -n "$ENV_NAME" --query properties.defaultDomain -o tsv)"
[ -n "$DOMAIN" ] || die "container apps environment $ENV_NAME not found in $RG"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://$APP.$DOMAIN}"
ACR_SERVER="$(az acr show -n "$REGISTRY" --query loginServer -o tsv)"

ENV_VARS=(
  "AZURE_STORAGE_CONNECTION_STRING=secretref:$SECRET_NAME"
  "AZURE_BLOB_CONTAINER=$BLOB_CONTAINER"
  "STORAGE=azure"
  "PUBLIC_BASE_URL=$PUBLIC_BASE_URL"
  "ZENVI_EDITOR_URL=$EDITOR_URL"
  "SUPABASE_URL=$SUPABASE"
  "SUPABASE_ANON_KEY=$ANON"
  "ZENVI_BACKEND_URL=$BACKEND"
  "CORS_ORIGINS=$CORS"
  "NODE_ENV=production"
  "LOG_LEVEL=info"
)
[ -n "$ALIASES" ] && ENV_VARS+=("PUBLIC_BASE_URL_ALIASES=$ALIASES")
[ -n "$MCP_ALIASES" ] && ENV_VARS+=("MCP_URL_ALIASES=$MCP_ALIASES")
SECRETS=("$SECRET_NAME=$CONN")
if [ -n "$SERVICE_SECRET" ]; then
  SECRETS+=("backend-service-secret=$SERVICE_SECRET")
  ENV_VARS+=("ZENVI_BACKEND_SERVICE_SECRET=secretref:backend-service-secret")
fi
if [ -n "$SERVICE_ROLE" ]; then
  SECRETS+=("supabase-service-role-key=$SERVICE_ROLE")
  ENV_VARS+=("SUPABASE_SERVICE_ROLE_KEY=secretref:supabase-service-role-key")
fi
if [ -n "$PEXELS_KEY" ]; then
  SECRETS+=("pexels-api-key=$PEXELS_KEY")
  ENV_VARS+=("PEXELS_API_KEY=secretref:pexels-api-key")
fi
if [ -n "$FREESOUND_KEY" ]; then
  SECRETS+=("freesound-api-key=$FREESOUND_KEY")
  ENV_VARS+=("FREESOUND_API_KEY=secretref:freesound-api-key")
fi
[ -n "$IMAGE_TAG" ] && ENV_VARS+=("ZENVI_CLOUD_VERSION=$IMAGE_TAG")
[ -n "$RENDER_QUEUE" ] && ENV_VARS+=("ZENVI_RENDER_QUEUE=$RENDER_QUEUE")
TAG_ARGS=()
# shellcheck disable=SC2206 # space-separated key=value pairs, by design
[ -n "$TAGS" ] && TAG_ARGS=(--tags $TAGS)

if ! az containerapp show -g "$RG" -n "$APP" -o none 2>/dev/null; then
  [ -n "$IMAGE_TAG" ] || die "IMAGE_TAG is required to create $APP (build one with scripts/azure/deploy.sh)"
  step "Creating container app $APP ($ACR_SERVER/zenvi-cloud:$IMAGE_TAG)"
  ACR_USER="$(az acr credential show -n "$REGISTRY" --query username -o tsv)"
  ACR_PASS="$(az acr credential show -n "$REGISTRY" --query 'passwords[0].value' -o tsv)"
  az containerapp create -g "$RG" -n "$APP" --environment "$ENV_NAME" \
    --image "$ACR_SERVER/zenvi-cloud:$IMAGE_TAG" \
    --registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
    --ingress external --target-port 8080 --transport auto \
    --min-replicas "$MIN_REPLICAS" --max-replicas "$MAX_REPLICAS" --cpu "$CPU" --memory "$MEMORY" \
    --secrets "${SECRETS[@]}" \
    --env-vars "${ENV_VARS[@]}" \
    ${TAG_ARGS[@]+"${TAG_ARGS[@]}"} \
    -o none
else
  step "Updating container app $APP"
  az containerapp secret set -g "$RG" -n "$APP" --secrets "${SECRETS[@]}" -o none
  IMAGE_ARGS=()
  [ -n "$IMAGE_TAG" ] && IMAGE_ARGS=(--image "$ACR_SERVER/zenvi-cloud:$IMAGE_TAG")
  az containerapp update -g "$RG" -n "$APP" ${IMAGE_ARGS[@]+"${IMAGE_ARGS[@]}"} \
    --min-replicas "$MIN_REPLICAS" --max-replicas "$MAX_REPLICAS" --cpu "$CPU" --memory "$MEMORY" \
    --set-env-vars "${ENV_VARS[@]}" \
    -o none
  az containerapp ingress update -g "$RG" -n "$APP" --type external --target-port 8080 --transport auto -o none
fi

FQDN="$(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.ingress.fqdn -o tsv)"
step "Done: https://$FQDN (PUBLIC_BASE_URL=$PUBLIC_BASE_URL)"
