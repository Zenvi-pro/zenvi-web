import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "motion",
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 120000,
  },
});
