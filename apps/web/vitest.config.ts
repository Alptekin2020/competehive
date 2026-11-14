import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // tsconfig "jsx: preserve" (Next.js) — bileşen testleri için JSX'i oxc dönüştürsün.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@competehive/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
});
