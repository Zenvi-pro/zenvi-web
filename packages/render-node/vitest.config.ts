import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "render-node",
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 60000,
    // Derived caches (font index) go to a temp folder, never the user's cache.
    env: { ZENVI_CACHE_DIR: path.join(tmpdir(), "zenvi-test-cache") },
  },
});
