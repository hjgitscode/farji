import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Database tests need a real PostgreSQL; run them with `npm run test:db`.
    // Chain integration tests need a local Hardhat node: run them with `npm run test:chain`.
    exclude: ["tests/db/**", "tests/chain-int/**", "node_modules/**"],
  },
});
