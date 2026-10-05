import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "adobe-link",
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Build, spawn and real-server tests; the shared dev machine can be slow.
    testTimeout: 60000,
  },
});
