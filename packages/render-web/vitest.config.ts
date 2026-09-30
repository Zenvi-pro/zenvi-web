import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "render-web",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
