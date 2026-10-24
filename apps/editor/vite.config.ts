import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));

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
    plugins: [react(), tailwindcss()],
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
