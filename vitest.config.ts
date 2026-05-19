import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    projects: ["apps/web", "apps/worker", "packages/shared"],
  },
});
