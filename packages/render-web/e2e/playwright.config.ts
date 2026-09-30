import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Browser smoke suite for @zenvi/render-web: real WebCodecs, Canvas2D and
// Web Audio in Chromium. One worker (one browser at a time), headless.
//   npx playwright test -c packages/render-web/e2e/playwright.config.ts
export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  // Traces and screenshots of failures stay out of the source tree.
  outputDir: join(tmpdir(), "zenvi-render-web-e2e-results"),
  use: {
    browserName: "chromium",
    headless: true,
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
});
