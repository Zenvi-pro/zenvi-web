import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * The editor is its own Vercel project, mounted at zenvi.pro/editor by an
 * external rewrite from the website, so every asset and API path lives under
 * `/editor/`. Backend REST goes through a same-origin proxy
 * (`/editor/api/zenvi/*` → `<backend>/api/v1/*`) because the production
 * backend only allows CORS from zenvi.pro; `vercel.json` does the same in
 * production. The chat WebSocket goes direct (no CORS for WebSockets).
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
