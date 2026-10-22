import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Deployment-readiness guarantees that can be checked without a network: no secrets in the repository, the environment is
// documented, the platform configuration is minimal and safe, the browser bundle carries no server secret, and the Sepolia
// scripts cannot touch mainnet or read a key from the environment.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const tracked = () =>
  execSync("git ls-files --cached --others --exclude-standard", { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => existsSync(join(root, f)) && statSync(join(root, f)).isFile())
    .filter((f) => !/^(node_modules|artifacts|cache|\.next)\//.test(f) && !f.includes("lib/database/generated") && f !== "package-lock.json" && !/\.(png|ico|jpg|svg|woff2?)$/.test(f));

describe("no secrets in the repository", () => {
  const files = tracked();

  it("scans a meaningful set of files", () => {
    expect(files.length).toBeGreaterThan(150);
    expect(files).not.toContain(".env");
    expect(files.some((f) => f.startsWith(".keystore"))).toBe(false);
    expect(files.some((f) => f.startsWith("deployments/"))).toBe(false);
  });

  it("holds no private key, mnemonic, service-role key or credentialed connection string", () => {
    const allowedKeyFiles = new Set(["tests/fixtures/test-wallets.ts", "tests/deploy/structural.test.ts"]); // the public Hardhat development key, test-only
    for (const f of files) {
      const text = read(f);
      expect(text, f).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
      expect(text, f).not.toMatch(/\bsb_secret_[A-Za-z0-9_-]{8,}/);
      expect(text, f).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/); // JWT-shaped (service-role / anon keys)
      expect(text, f).not.toMatch(/\b(PRIVATE_KEY|MNEMONIC|SEED_PHRASE)\s*[=:]\s*["']?(0x)?[0-9a-fA-F]{40,}/);
      expect(text, f).not.toMatch(/postgres(ql)?:\/\/[^\s:@<>"']+:(?!<password>|pw@|p@|password@|\*+@|pw:|u:p)[^\s@<>"']{6,}@(?!localhost|127\.0\.0\.1)/i);
      if (!allowedKeyFiles.has(f)) expect(text, f).not.toMatch(/0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80/i);
    }
  });

  it("keeps secrets, keystores and deployment records out of git", () => {
    const ignore = read(".gitignore");
    for (const entry of [".env", ".env.*", "!.env.example", "/.keystore", "/deployments", ".vercel/"]) expect(ignore).toContain(entry);
  });
});

describe("the environment is documented and safe", () => {
  const names = (() => {
    const found = new Set<string>();
    const dirs = ["app", "lib", "server", "components", "scripts", "config"];
    const walk = (d: string): string[] => readdirSync(join(root, d)).flatMap((n) => (n === "generated" ? [] : statSync(join(root, d, n)).isDirectory() ? walk(`${d}/${n}`) : /\.(ts|tsx|cjs)$/.test(n) ? [`${d}/${n}`] : []));
    for (const f of [...dirs.flatMap(walk), "proxy.ts", "instrumentation.ts", "hardhat.config.ts"]) {
      for (const m of code(f).matchAll(/(?:process\.env|env)\.((?:FARJI|NEXT_PUBLIC|DATABASE|DIRECT)[A-Z0-9_]*)/g)) found.add(m[1]);
      for (const m of code(f).matchAll(/["']((?:FARJI_|NEXT_PUBLIC_)[A-Z0-9_]+)["']/g)) found.add(m[1]);
    }
    return [...found].filter((n) => !/_V\d+$/.test(n)); // domain-separation tags such as FARJI_CREDENTIAL_ID_V1 are not environment variables
  })();

  it("every FARJI / NEXT_PUBLIC / database variable the code reads is in .env.example and docs/DEPLOYMENT.md", () => {
    expect(names.length).toBeGreaterThan(10);
    const example = read(".env.example");
    const doc = read("docs/DEPLOYMENT.md");
    for (const n of names) {
      expect(example, `.env.example is missing ${n}`).toContain(n);
      expect(doc, `docs/DEPLOYMENT.md is missing ${n}`).toContain(n);
    }
  });

  it(".env.example contains no real value", () => {
    for (const line of read(".env.example").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const v = m[2].trim();
      expect(v === "" || /<.+>|^https?:\/\/(localhost|127\.0\.0\.1)|^finalized$|^sb_publishable_<|^postgresql:\/\/postgres\.<|^http:\/\/localhost/.test(v) || m[1] === "FARJI_FINALITY", `${m[1]} looks like a real value`).toBe(true);
    }
  });

  it("nothing sensitive is read under a browser prefix and client components read no server variable", () => {
    for (const n of names.filter((x) => x.startsWith("NEXT_PUBLIC_"))) expect(n).toMatch(/^NEXT_PUBLIC_(APP_URL|SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|SUPABASE_ANON_KEY)$/);
    const all = ["app", "components", "lib"].flatMap((d) => {
      const walk = (dir: string): string[] => readdirSync(join(root, dir)).flatMap((n) => (n === "generated" ? [] : statSync(join(root, dir, n)).isDirectory() ? walk(`${dir}/${n}`) : /\.tsx?$/.test(n) ? [`${dir}/${n}`] : []));
      return walk(d);
    });
    const clients = all.filter((f) => /^\s*["']use client["']/.test(read(f)));
    expect(clients.length).toBeGreaterThan(5);
    for (const f of clients) {
      const src = code(f);
      expect(src, f).not.toMatch(/process\.env\.(?!NEXT_PUBLIC_)/);
      for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*from\s+["']@\/(server|lib\/database)[^"']*["']/gm)) expect.fail(`${f} imports server code at runtime: ${m[0]}`);
    }
  });

  it("the chain sync token is only read by the sync route and the operator script", () => {
    const users = ["app", "lib", "server", "components", "scripts", "config"].flatMap((d) => {
      const walk = (dir: string): string[] => readdirSync(join(root, dir)).flatMap((n) => (n === "generated" ? [] : statSync(join(root, dir, n)).isDirectory() ? walk(`${dir}/${n}`) : /\.(tsx?|cjs)$/.test(n) ? [`${dir}/${n}`] : []));
      return walk(d);
    }).filter((f) => /FARJI_SYNC_TOKEN/.test(code(f)));
    expect(users.sort()).toEqual(["app/api/chain/sync/route.ts", "config/production-env.ts", "scripts/chain-sync.cjs"]);
  });
});

describe("platform configuration", () => {
  it("vercel.json schedules only the token-protected sync route, with no secret", () => {
    const cfg = JSON.parse(read("vercel.json"));
    expect(cfg.crons).toHaveLength(1);
    expect(cfg.crons[0].path).toBe("/api/chain/sync");
    expect(cfg.crons[0].path).not.toContain("?");
    expect(cfg.crons[0].schedule).toMatch(/^\S+ \S+ \S+ \S+ \S+$/);
    expect(JSON.stringify(cfg)).not.toMatch(/token|secret|key/i);
  });

  it("the optional GitHub Actions sync is off unless enabled and takes its secrets from the repository settings", () => {
    const wf = read(".github/workflows/chain-sync.yml");
    expect(wf).toContain("vars.FARJI_SYNC_ENABLED == 'true'");
    expect(wf).toContain("${{ secrets.FARJI_SYNC_TOKEN }}");
    expect(wf).not.toMatch(/Bearer [A-Za-z0-9]{16,}/);
  });

  it("every response carries baseline security headers and no framework banner", () => {
    const cfg = read("next.config.ts");
    const headers = read("config/security-headers.ts");
    for (const h of ["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security"]) expect(headers).toContain(h);
    expect(cfg).toContain("securityHeaders(");
    expect(cfg).toMatch(/source: "\/:path\*"/);
    expect(cfg).toContain("poweredByHeader: false");
  });

  it("Prisma is generated on install so a hosted build works, and Node is pinned to a supported range", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.postinstall).toBe("prisma generate");
    expect(pkg.engines.node).toMatch(/22|>=22/);
  });

  it("server startup reports configuration problems by name only", () => {
    const src = code("instrumentation.ts");
    expect(src).toContain("validateProductionEnv");
    expect(src).not.toMatch(/console\.\w+\([^)]*process\.env\./);
  });

  it("the wallet actions always pass the full chain context so the endpoint check runs", () => {
    for (const f of ["app/admin/actions.ts", "app/issuer/chain-actions.ts"]) {
      const src = code(f);
      for (const m of src.matchAll(/(buildTransaction|recordSubmittedTransaction)\(getDb\(\), ([^,]+),/g)) expect(m[2], f).toBe("getChain()");
    }
  });
});

describe("Sepolia scripts", () => {
  const scripts = ["scripts/deploy-sepolia.cjs", "scripts/keystore.cjs", "scripts/check-deployment.cjs"];

  it("never read a private key or mnemonic from the environment", () => {
    for (const f of scripts.concat(["scripts/deploy.ts", "scripts/chain-sync.cjs", "scripts/prompt.cjs"])) {
      expect(code(f), f).not.toMatch(/process\.env\.\w*(PRIVATE|MNEMONIC|SEED|SECRET)\w*/i);
      expect(code(f), f).not.toMatch(/process\.env\[/);
    }
    expect(code("hardhat.config.ts")).not.toMatch(/accounts\s*:/); // no key is configured for any network
  });

  it("deploy to Sepolia only and refuse Ethereum mainnet", () => {
    const src = read("scripts/deploy-sepolia.cjs");
    expect(src).toContain("11155111n");
    expect(src).toMatch(/chainId === 1n[\s\S]{0,80}MAINNET/);
    expect(src).toMatch(/chainId !== SEPOLIA/);
    expect(src).toMatch(/delay < 86400/);
    expect(src).toContain("deploy to sepolia"); // an explicit typed confirmation
  });

  it("use an encrypted keystore, a hidden password prompt, and never print a key or password", () => {
    const deploy = read("scripts/deploy-sepolia.cjs");
    expect(deploy).toContain("fromEncryptedJson");
    expect(deploy).toMatch(/hidden: true/);
    expect(deploy).not.toMatch(/console\.\w+\([^)]*(password|privateKey|\.signingKey|mnemonic)/i);
    const ks = read("scripts/keystore.cjs");
    expect(ks).toContain("wallet.encrypt(");
    expect(ks).toContain('flag: "wx"'); // never overwrite an existing keystore
    expect(ks).toMatch(/mode: 0o600/);
    expect(ks).not.toMatch(/console\.\w+\([^)]*(privateKey|key\b|mnemonic)/i);
  });

  it("the deployer holds no authority after deployment: admin defaults to the configured wallets, never the deployer", () => {
    const src = read("scripts/deploy-sepolia.cjs");
    expect(src).toMatch(/const defaultAdmin = \(process\.env\.FARJI_DEFAULT_ADMIN \|\| admin\)/);
    expect(src).not.toMatch(/defaultAdmin = .*deployer\.address/);
  });
});
