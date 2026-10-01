import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

// End-to-end suite for the web editor: real Chromium (WebCodecs, OPFS,
// Web Audio) against `vite preview` of the production build.
//   npm run build -w @zenvi/editor
//   npx playwright test -c apps/editor/e2e/playwright.config.ts
// One worker, one browser; the preview server gets a free port per run.

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");

function freePort(): number {
  const out = execFileSync(process.execPath, [
    "-e",
    "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})",
  ]);
  return Number(out.toString());
}

const port = Number(process.env.ZENVI_E2E_PORT) || freePort();
process.env.ZENVI_E2E_PORT = String(port);
// ZENVI_E2E_DEV=1 runs against the dev server (no build; slower first load).
const dev = process.env.ZENVI_E2E_DEV === "1";

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  outputDir: join(tmpdir(), "zenvi-editor-e2e-results"),
  globalSetup: join(here, "support", "global-setup.ts"),
  globalTeardown: join(here, "support", "global-teardown.ts"),
  webServer: {
    command: dev ? `npx vite --host 127.0.0.1 --port ${port} --strictPort` : `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: appDir,
    url: `http://127.0.0.1:${port}/editor/`,
    reuseExistingServer: false,
    timeout: dev ? 300_000 : 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
});
