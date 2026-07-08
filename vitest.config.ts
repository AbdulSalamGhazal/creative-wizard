import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // `tests/db/**` is the real-database suite — it needs docker + ccms_test and
    // runs via `npm run test:db` (vitest.config.db.ts). Keep the default suite
    // pure-unit so CI/dev without docker stays green.
    exclude: ["node_modules", ".next", "tests/db/**"],
    setupFiles: ["./vitest.setup.ts"],
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
