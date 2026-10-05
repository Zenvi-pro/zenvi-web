import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "adobe-link",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
