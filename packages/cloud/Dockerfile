# syntax=docker/dockerfile:1
#
# Zenvi Cloud service image. Build context: the repository root, or the
# staged copy of the committed tree that scripts/azure/deploy.sh uploads:
#
#   az acr build -r zenviregistry -t zenvi-cloud:<tag> -f packages/cloud/Dockerfile .
#
# Stage 1 installs only what @zenvi/cloud needs (it and its workspace
# dependencies, @zenvi/engine and @zenvi/render-node) and bundles the service
# with esbuild. Stage 2 builds the web editor, which the service hosts for the
# editor embedded in chats (/editor/embed/…, src/http/editor.ts). Stage 3 is
# Node + ffmpeg + the bundle + the editor build, running as `node`.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
ENV npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false
# Manifests first, so the dependency layer is reused when only sources change.
# Every workspace manifest is copied so npm sees the same workspace set as the lockfile.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/render-node/package.json packages/render-node/
COPY packages/cloud/package.json packages/cloud/
COPY packages/cli/package.json packages/cli/
COPY packages/render-web/package.json packages/render-web/
COPY apps/editor/package.json apps/editor/
RUN npm ci --workspace @zenvi/cloud --ignore-scripts
COPY packages/engine packages/engine
COPY packages/render-node packages/render-node
COPY packages/cloud packages/cloud
RUN npm run build --workspace @zenvi/cloud

FROM node:22-bookworm-slim AS editor
WORKDIR /repo
ENV npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/render-node/package.json packages/render-node/
COPY packages/cloud/package.json packages/cloud/
COPY packages/cli/package.json packages/cli/
COPY packages/render-web/package.json packages/render-web/
COPY apps/editor/package.json apps/editor/
RUN npm ci --workspace @zenvi/editor --ignore-scripts
COPY packages/engine packages/engine
COPY packages/render-web packages/render-web
COPY apps/editor apps/editor
# The embed calls this service on its own origin; nothing else is configured.
RUN npm run build --workspace @zenvi/editor

FROM node:22-bookworm-slim
# ffmpeg/ffprobe for probing and rendering; DejaVu so SVG titles have a real
# sans face; tini to forward SIGTERM and reap ffmpeg children.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=8080 RENDER_TMP_DIR=/tmp ZENVI_EDITOR_DIST=/app/editor
WORKDIR /app
COPY --from=build /repo/packages/cloud/dist ./dist
COPY --from=editor /repo/apps/editor/dist/editor ./editor
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/server.mjs"]
