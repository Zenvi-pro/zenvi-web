#!/usr/bin/env bash
# Serialize `npm install` across parallel agents working in this checkout.
# Usage: scripts/npm-install.sh [npm install args...]
#   scripts/npm-install.sh                       # install everything
#   scripts/npm-install.sh -w @zenvi/editor foo  # add a dependency to a workspace
set -euo pipefail
cd "$(dirname "$0")/.."
lock=".npm-install.lock"
for _ in $(seq 1 600); do
  if mkdir "$lock" 2>/dev/null; then
    trap 'rmdir "$lock"' EXIT
    npm install --no-audit --no-fund "$@"
    exit 0
  fi
  sleep 1
done
echo "timed out waiting for $lock (another npm install is running?)" >&2
exit 1
