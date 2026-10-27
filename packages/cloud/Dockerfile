# syntax=docker/dockerfile:1
#
# Zenvi Cloud service image. Build context: the repository root, or the
# staged copy of the committed tree that scripts/azure/deploy.sh uploads:
#
#   az acr build -r zenviregistry -t zenvi-cloud:<tag> -f packages/cloud/Dockerfile .
#
# Stage 1 installs only what @zenvi/cloud needs (it and its workspace
# dependencies: @zenvi/engine, @zenvi/render-node, @zenvi/scenes3d and
# @zenvi/motion), bundles the service with esbuild and prebuilds the Zenvi
# Motion block pages, and downloads chrome-headless-shell. Stage 2 builds the
# web editor, which the service hosts for the editor embedded in chats
# (/editor/embed/…, src/http/editor.ts). Stage 3 is Node + ffmpeg + Chrome's
# libraries + the bundle + onnxruntime-node + the editor build, running as `node`.

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
COPY packages/scenes3d/package.json packages/scenes3d/
COPY packages/motion/package.json packages/motion/
COPY apps/editor/package.json apps/editor/
RUN npm ci --workspace @zenvi/cloud --ignore-scripts
COPY packages/engine packages/engine
COPY packages/render-node packages/render-node
COPY packages/scenes3d packages/scenes3d
COPY packages/motion packages/motion
COPY packages/cloud packages/cloud
RUN npm run build --workspace @zenvi/cloud
# Subject mattes load onnxruntime-node at run time (a bundle external). Its
# package carries every platform's binaries: keep this one's. --ignore-scripts
# above skipped its install script, which only fetches GPU providers.
RUN arch="$(node -p process.arch)" \
 && mkdir -p /opt/ort/node_modules \
 && cp -r node_modules/onnxruntime-node node_modules/onnxruntime-common /opt/ort/node_modules/ \
 && find /opt/ort/node_modules/onnxruntime-node/bin -mindepth 2 -maxdepth 2 ! -name linux -exec rm -rf {} + \
 && find /opt/ort/node_modules/onnxruntime-node/bin -mindepth 3 -maxdepth 3 ! -name "$arch" -exec rm -rf {} + \
 && test -f /opt/ort/node_modules/onnxruntime-node/bin/napi-v6/linux/$arch/onnxruntime_binding.node
# Zenvi Motion renders blocks with chrome-headless-shell (Chrome for Testing,
# linux64), pinned so renders do not change under a rebuild.
ARG CHROME_VERSION=156.0.8078.47
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/* \
 && npx --no-install @puppeteer/browsers install "chrome-headless-shell@${CHROME_VERSION}" --path /opt/chrome \
 && ln -s "$(find /opt/chrome -type f -name chrome-headless-shell -perm -u+x | head -n 1)" /opt/chrome/chrome-headless-shell-bin

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
# sans face, and Liberation Sans because motion templates measure their text
# with Helvetica/Arial widths, which it shares (DejaVu Sans runs wider); tini
# to forward SIGTERM and reap ffmpeg and Chrome children; the shared libraries
# chrome-headless-shell links against (checked with ldd below).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini fonts-dejavu-core fonts-liberation \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdbus-1-3 libdrm2 libexpat1 libgbm1 libasound2 \
    libxkbcommon0 libx11-6 libxcb1 libxext6 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 \
 && rm -rf /var/lib/apt/lists/*
# Chrome's own sandbox needs user namespaces, which Container Apps does not
# grant; block pages reach only their local page server (motion chrome.ts).
ENV NODE_ENV=production PORT=8080 RENDER_TMP_DIR=/tmp ZENVI_EDITOR_DIST=/app/editor \
    ZENVI_CHROME=/opt/chrome/chrome-headless-shell-bin ZENVI_CHROME_NO_SANDBOX=1
WORKDIR /app
COPY --from=build /opt/chrome /opt/chrome
RUN ! ldd "$(readlink -f "$ZENVI_CHROME")" | grep "not found"
COPY --from=build /opt/ort/node_modules ./node_modules
COPY --from=build /repo/packages/cloud/dist ./dist
COPY --from=editor /repo/apps/editor/dist/editor ./editor
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/server.mjs"]
