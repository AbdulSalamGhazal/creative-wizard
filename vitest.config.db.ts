import { defineConfig } from "vitest/config";
import path from "node:path";
import { TEST_DATABASE_URL } from "./tests/db/config";

/**
 * Separate config for the real-database suite (`npm run test:db`). It provisions
 * `ccms_test` via globalSetup and points `DATABASE_URL` at it for every worker.
 * The DEFAULT `vitest run` excludes `tests/db/**` so CI/dev without docker stays
 * green. Runs single-fork/serial since every test shares the one database.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["./tests/db/global-setup.ts"],
    env: { DATABASE_URL: TEST_DATABASE_URL },
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  css: {
    // Skip Tailwind/PostCSS — these specs never touch styles.
    postcss: { plugins: [] },
  },
});
