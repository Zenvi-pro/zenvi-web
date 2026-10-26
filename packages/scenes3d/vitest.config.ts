import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "scenes3d",
    include: ["src/**/*.test.ts"],
    environment: "node",
    // The Blender smoke test compiles shaders on first run.
    testTimeout: 120000,
  },
});
