import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  css: {
    // Skip Tailwind/PostCSS in tests — none of our specs touch styles.
    postcss: { plugins: [] },
  },
});
