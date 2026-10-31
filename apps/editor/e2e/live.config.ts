import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Post-deploy smoke test of the public web editor (read-only: nothing is
// saved anywhere but the test browser's own storage). No local server.
//   npx playwright test -c apps/editor/e2e/live.config.ts
//   ZENVI_LIVE_URL=https://staging.example/editor/ npx playwright test -c apps/editor/e2e/live.config.ts

export default defineConfig({
  testDir: ".",
  testMatch: "live.smoke.ts",
  workers: 1,
  retries: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  outputDir: join(tmpdir(), "zenvi-live-smoke-results"),
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: process.env.ZENVI_LIVE_URL || "https://zenvi.pro/editor/",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
