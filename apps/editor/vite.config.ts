import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const emojiDir = fileURLToPath(new URL("../../packages/engine/assets/emojis", import.meta.url));

/**
 * The engine's bundled emoji (`@zenvi/engine/assets/emojis`: 1,239 OpenMoji
 * SVGs and their catalog) served as plain files at `<base>emojis/`, so a
 * project's `@emojis/…` stickers and the emoji tools fetch only what they use
 * and nothing lands in the app's JavaScript.
 */
function engineEmojis(): Plugin {
  let base = "/";
  return {
    name: "zenvi-engine-emojis",
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0]!;
        if (!url.startsWith(`${base}emojis/`)) return next();
        try {
          const name = decodeURIComponent(url.slice(base.length + "emojis/".length));
          if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".")) return next();
          const body = readFileSync(path.join(emojiDir, name));
          res.setHeader("Content-Type", name.endsWith(".json") ? "application/json" : "image/svg+xml");
          res.end(body);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const name of readdirSync(emojiDir)) {
        this.emitFile({ type: "asset", fileName: `emojis/${name}`, source: readFileSync(path.join(emojiDir, name)) });
      }
    },
  };
}

/**
 * The editor is served at zenvi.pro/editor (copied into the website's Azure
 * Static Web App by the website's deploy workflow), so every asset and API
 * path lives under `/editor/`. In dev, backend REST goes through this
 * same-origin proxy (`/editor/api/zenvi/*` → `<backend>/api/v1/*`) because
 * the production backend only allows CORS from zenvi.pro; production builds
 * set `VITE_ZENVI_BACKEND_REST_URL` and call the backend directly. The chat
 * WebSocket goes direct (no CORS for WebSockets).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  const backend = env.VITE_ZENVI_BACKEND_URL || "https://api.zenvi.pro";
  const proxy: Record<string, ProxyOptions> = {
    "/editor/api/zenvi": {
      target: backend,
      changeOrigin: true,
      secure: true,
      rewrite: (path) => path.replace(/^\/editor\/api\/zenvi/, "/api/v1"),
    },
  };
  return {
    base: "/editor/",
    plugins: [react(), tailwindcss(), engineEmojis()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    build: {
      outDir: "dist/editor",
      emptyOutDir: true,
      target: "es2022",
      sourcemap: true,
      chunkSizeWarningLimit: 1500,
    },
    worker: { format: "es" },
    server: { proxy },
    preview: { proxy },
  };
});
