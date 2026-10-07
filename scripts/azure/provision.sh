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
#
# Touches only: blob container + tables in the storage account, and the
# container app `zenvi-cloud` in environment `zenvi-env`. Other apps in the
# environment are left alone.
set -euo pipefail

RG="${RG:-zenvi-rg}"
ENV_NAME="${ENV_NAME:-zenvi-env}"
APP="${APP:-zenvi-cloud}"
REGISTRY="${REGISTRY:-zenviregistry}"
BLOB_CONTAINER="${BLOB_CONTAINER:-zenvi}"
ENV_FILE="${ENV_FILE:-$HOME/.config/zenvi-dev/cloud.env}"
EDITOR_URL="${ZENVI_EDITOR_URL:-https://zenvi.pro/editor}"
SUPABASE="${SUPABASE_URL:-https://xktarhzbrdnxkaovtdxj.supabase.co}"
CORS="${CORS_ORIGINS:-https://zenvi.pro,https://www.zenvi.pro,https://*.vercel.app,http://localhost:*,http://127.0.0.1:*}"
ALIASES="${PUBLIC_BASE_URL_ALIASES:-}"
IMAGE_TAG="${IMAGE_TAG:-}"
SECRET_NAME="azure-storage-connection-string"

die() { echo "provision: $*" >&2; exit 1; }
step() { echo "==> $*"; }

command -v az >/dev/null || die "the Azure CLI (az) is required"
[ -r "$ENV_FILE" ] || die "missing $ENV_FILE"
# The value contains ';' — read it verbatim instead of sourcing the file.
CONN="$(sed -n 's/^AZURE_STORAGE_CONNECTION_STRING=//p' "$ENV_FILE" | head -n 1)"
[ -n "$CONN" ] || die "AZURE_STORAGE_CONNECTION_STRING is not set in $ENV_FILE"

step "Storage: blob container '$BLOB_CONTAINER' (private) and tables"
az storage container create --name "$BLOB_CONTAINER" --public-access off --connection-string "$CONN" -o none
for table in tokens oauthclients oauthcodes devicecodes renders; do
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
  "CORS_ORIGINS=$CORS"
  "NODE_ENV=production"
  "LOG_LEVEL=info"
)
[ -n "$ALIASES" ] && ENV_VARS+=("PUBLIC_BASE_URL_ALIASES=$ALIASES")
[ -n "$IMAGE_TAG" ] && ENV_VARS+=("ZENVI_CLOUD_VERSION=$IMAGE_TAG")

if ! az containerapp show -g "$RG" -n "$APP" -o none 2>/dev/null; then
  [ -n "$IMAGE_TAG" ] || die "IMAGE_TAG is required to create $APP (build one with scripts/azure/deploy.sh)"
  step "Creating container app $APP ($ACR_SERVER/zenvi-cloud:$IMAGE_TAG)"
  ACR_USER="$(az acr credential show -n "$REGISTRY" --query username -o tsv)"
  ACR_PASS="$(az acr credential show -n "$REGISTRY" --query 'passwords[0].value' -o tsv)"
  az containerapp create -g "$RG" -n "$APP" --environment "$ENV_NAME" \
    --image "$ACR_SERVER/zenvi-cloud:$IMAGE_TAG" \
    --registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
    --ingress external --target-port 8080 --transport auto \
    --min-replicas 1 --max-replicas 1 --cpu 1 --memory 2Gi \
    --secrets "$SECRET_NAME=$CONN" \
    --env-vars "${ENV_VARS[@]}" \
    -o none
else
  step "Updating container app $APP"
  az containerapp secret set -g "$RG" -n "$APP" --secrets "$SECRET_NAME=$CONN" -o none
  IMAGE_ARGS=()
  [ -n "$IMAGE_TAG" ] && IMAGE_ARGS=(--image "$ACR_SERVER/zenvi-cloud:$IMAGE_TAG")
  az containerapp update -g "$RG" -n "$APP" ${IMAGE_ARGS[@]+"${IMAGE_ARGS[@]}"} \
    --min-replicas 1 --max-replicas 1 --cpu 1 --memory 2Gi \
    --set-env-vars "${ENV_VARS[@]}" \
    -o none
  az containerapp ingress update -g "$RG" -n "$APP" --type external --target-port 8080 --transport auto -o none
fi

FQDN="$(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.ingress.fqdn -o tsv)"
step "Done: https://$FQDN (PUBLIC_BASE_URL=$PUBLIC_BASE_URL)"
