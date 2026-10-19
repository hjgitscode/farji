import { defineConfig } from "vitest/config";
import path from "node:path";

// Real-chain integration tests: they start a LOCAL Hardhat node, deploy FarjiRegistry to it and drive
// the application against it (plus the real Supabase database, rollback-only like `test:db`).
// Run with `npm run test:chain` (which compiles the contracts first).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    include: ["tests/chain-int/**/*.test.ts"],
    globalSetup: ["tests/chain-int/global-setup.ts"],
    setupFiles: ["tests/db/setup.ts"],
    fileParallelism: false,
    testTimeout: 240000,
    hookTimeout: 180000,
  },
});
