import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "render-web",
    // Browser behaviour (WebCodecs, Canvas, Web Audio) is covered by the
    // Playwright suite in e2e/; unit tests run in Node.
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Media fixture tests shell out to ffmpeg (and libopenshot when installed).
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
