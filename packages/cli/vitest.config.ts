import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "cli",
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 120000,
    // Never open browsers or write the user's caches from tests.
    env: { ZENVI_CACHE_DIR: path.join(tmpdir(), "zenvi-test-cache"), ZENVI_NO_BROWSER: "1" },
  },
});
