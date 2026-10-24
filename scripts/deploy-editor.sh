#!/usr/bin/env bash
# Deploy the web editor to zenvi.pro/editor by hand.
#
# The editor ships inside the website's Azure Static Web App (`zenvi-site`):
# Zenvi-pro/zenvi-pro's `azure-deploy.yml` builds both and uploads them
# together. A push to main here deploys on its own once CI passes
# (`.github/workflows/deploy-site.yml`); use this to ship another pushed ref.
#
#   scripts/deploy-editor.sh --prod          # main
#   scripts/deploy-editor.sh --prod <ref>    # a pushed branch, tag or SHA
#
# There are no previews: the backend's CORS only allows zenvi.pro. Try changes
# locally with `npm run dev -w @zenvi/editor`. Needs the GitHub CLI signed in.
set -euo pipefail

if [[ "${1:-}" != "--prod" ]]; then
  sed -n '2,13p' "$0" | sed -E 's/^# ?//'
  exit 2
fi
ref="${2:-main}"

gh workflow run azure-deploy.yml -R Zenvi-pro/zenvi-pro -f editor_ref="$ref"
echo "Deploying $ref to zenvi.pro. Follow it with:"
echo "  gh run list -R Zenvi-pro/zenvi-pro -w azure-deploy.yml -L 1"
