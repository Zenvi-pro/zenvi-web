#!/usr/bin/env bash
# Build the web editor locally and deploy the static output to the Vercel
# project `zenvi-editor` (mounted at zenvi.pro/editor by the website rewrite).
#
#   scripts/deploy-editor.sh           # preview deployment, prints its URL
#   scripts/deploy-editor.sh --prod    # production (zenvi-editor.vercel.app)
#
# Build-time settings come from apps/editor/.env.local (or the environment):
# VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_ZENVI_BACKEND_URL,
# VITE_ZENVI_CLOUD_URL. All of them are public; Vite inlines them.
#
# Vercel only serves files here: the monorepo is built on this machine (or in
# CI), so Vercel never needs npm workspaces or build minutes.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
project="${ZENVI_EDITOR_VERCEL_PROJECT:-zenvi-editor}"
prod=""
if [[ "${1:-}" == "--prod" ]]; then prod="--prod"; fi

cd "$root"
npm run build -w @zenvi/editor

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
cp -R apps/editor/dist/editor "$out/editor"

# Same routing/headers as apps/editor/vercel.json, minus the build settings.
node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  for (const k of ["buildCommand", "outputDirectory", "installCommand", "devCommand"]) delete cfg[k];
  cfg.framework = null;
  fs.writeFileSync(process.argv[2], JSON.stringify(cfg, null, 2) + "\n");
' apps/editor/vercel.json "$out/vercel.json"

cd "$out"
vercel link --yes --project "$project" >/dev/null
url="$(vercel deploy --yes $prod)"
echo "$url"
