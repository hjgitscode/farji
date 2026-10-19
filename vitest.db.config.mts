import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    setupFiles: ["tests/db/setup.ts"],
    fileParallelism: false,
    // Phase 6/7 fixtures sign several credentials per test over a remote database.
    testTimeout: 120000,
  },
});
