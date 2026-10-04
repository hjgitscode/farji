import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Database tests need a real PostgreSQL; run them with `npm run test:db`.
    exclude: ["tests/db/**", "node_modules/**"],
  },
});
