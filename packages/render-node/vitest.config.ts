import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "render-node",
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 60000,
  },
});
