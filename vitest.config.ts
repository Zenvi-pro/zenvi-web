import { defineConfig } from "vitest/config";

// One test runner for the whole monorepo. Each package keeps its tests next to
// its sources (`src/**/*.test.ts`). Browser-only code is tested with jsdom or
// Playwright inside its own package config.
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
  },
});
