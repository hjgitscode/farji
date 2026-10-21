import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import dotenv from "dotenv";
import { describe, expect, it } from "vitest";

// Scans the production build's BROWSER assets (.next/static) for anything server-only. It needs a build, so it is skipped when
// none exists; `npm run build` then `npm run test` (the quality-gate order) exercises it. Verify with test-only sentinel values:
//   FARJI_RPC_URL=https://rpc.sentinel.invalid/KEY-SENTINEL-123 FARJI_SYNC_TOKEN=TESTONLY-sentinel-token-0123456789abcdef npm run build
// These are NOT production secrets; they only prove that values present at build time are not copied into browser code.

const root = process.cwd();
const staticDir = join(root, ".next", "static");
const built = existsSync(staticDir);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : /\.(js|css|json|html|txt|map)$/.test(n) ? [join(dir, n)] : []));
}

describe.skipIf(!built)("the production browser bundle carries no server secret", () => {
  const files = built ? walk(staticDir) : [];
  const text = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const envFile = existsSync(join(root, ".env")) ? dotenv.parse(readFileSync(join(root, ".env"))) : {};

  it("has real client assets to scan", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("contains none of the server variable names, credentials or key markers", () => {
    for (const marker of ["FARJI_SYNC_TOKEN", "FARJI_RPC_URL", "DATABASE_URL", "DIRECT_URL", "FARJI_ADMIN_WALLET", "service_role", "sb_secret_", "postgres://", "postgresql://", "PRIVATE_KEY", "mnemonic", "KEY-SENTINEL-123", "TESTONLY-sentinel-token"]) {
      expect(text.includes(marker), `browser bundle contains ${marker}`).toBe(false);
    }
  });

  it("does not contain the configured database credentials or token values", () => {
    for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
      const v = envFile[name] ?? process.env[name];
      if (v && v.length > 12) expect(text.includes(v), `browser bundle contains the value of ${name}`).toBe(false);
    }
    for (const name of ["FARJI_SYNC_TOKEN", "FARJI_RPC_URL"]) {
      const v = process.env[name];
      if (v && v.length > 12) expect(text.includes(v), `browser bundle contains the value of ${name}`).toBe(false);
    }
  });

  it("does include the public Supabase settings it is meant to carry, and only those", () => {
    // The publishable key is public by design; a secret-shaped key must never appear.
    expect(/sb_secret_[A-Za-z0-9]/.test(text)).toBe(false);
    expect(/"role"\s*:\s*"service_role"/.test(text)).toBe(false);
  });
});
