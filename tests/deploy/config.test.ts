import { describe, expect, it } from "vitest";
import { authCookieOptions } from "@/lib/auth/cookies";
import { parseEnv } from "@/lib/core/env";
import { cleanOrigin, resolvePublicOrigin } from "@/lib/core/public-origin";
import { SEPOLIA_CHAIN_ID, validateProductionEnv } from "@/config/production-env";
import { RateLimiter, RULES } from "@/lib/security/rate-limit";
import { getChainConfig } from "@/server/chain/config";
import { clientKeyFrom } from "@/server/security/limit";

// Deployment configuration: the production environment matrix, public URLs, cookies, supported networks and the limiter.

const REGISTRY = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const good = {
  DATABASE_URL: "postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres",
  DIRECT_URL: "postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
  NEXT_PUBLIC_APP_URL: "https://farji.example",
  FARJI_PUBLIC_URL: "https://farji.example",
  FARJI_CHAIN_ID: "11155111",
  FARJI_REGISTRY_ADDRESS: REGISTRY,
  FARJI_RPC_URL: "https://rpc.sepolia.example/v1/abc",
  FARJI_FINALITY: "finalized",
  FARJI_ADMIN_WALLET: REGISTRY,
  FARJI_SYNC_TOKEN: "k3Jd9sLq2VbN7xPzR4tYw8mAcE6uHg1Fa",
};
const check = (over: Record<string, string | undefined>, production = true) => validateProductionEnv({ ...good, ...over }, { production });
const errorsOf = (over: Record<string, string | undefined>, production = true) => check(over, production).errors.join(" | ");

describe("production environment matrix", () => {
  it("a complete Sepolia configuration is valid", () => {
    expect(check({})).toEqual({ errors: [], warnings: [] });
  });

  it("missing required variables fail closed, by name", () => {
    for (const name of ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_APP_URL", "FARJI_CHAIN_ID", "FARJI_REGISTRY_ADDRESS", "FARJI_RPC_URL", "FARJI_SYNC_TOKEN"]) {
      expect(errorsOf({ [name]: undefined }), name).toContain(name);
    }
    expect(validateProductionEnv({}).errors.length).toBeGreaterThanOrEqual(8);
  });

  it("reports names and rules but never a value", () => {
    const report = JSON.stringify(check({ FARJI_SYNC_TOKEN: "short", DATABASE_URL: "postgresql://user:SUPERSECRETPW@localhost:5432/db", FARJI_RPC_URL: "http://localhost:8545" }));
    expect(report).not.toContain("SUPERSECRETPW");
    expect(report).not.toContain("short");
    expect(report).toContain("FARJI_SYNC_TOKEN");
  });

  it("enforces the Sepolia rules: supported network, finalized finality, public https RPC", () => {
    expect(errorsOf({ FARJI_CHAIN_ID: "1" })).toMatch(/mainnet/);
    expect(errorsOf({ FARJI_CHAIN_ID: "137" })).toMatch(/not a supported network/);
    expect(errorsOf({ FARJI_CHAIN_ID: "31337" })).toMatch(/local development network in a production/);
    expect(errorsOf({ FARJI_CHAIN_ID: "abc" })).toMatch(/positive integer/);
    expect(errorsOf({ FARJI_FINALITY: "depth:0" })).toMatch(/must be "finalized" on a public network/);
    expect(errorsOf({ FARJI_FINALITY: "depth:2" })).toMatch(/finalized/);
    expect(errorsOf({ FARJI_FINALITY: "nonsense" })).toMatch(/FARJI_FINALITY/);
    expect(errorsOf({ FARJI_RPC_URL: "http://rpc.example" })).toMatch(/https/);
    expect(errorsOf({ FARJI_RPC_URL: "https://localhost:8545" })).toMatch(/public/);
    expect(errorsOf({ FARJI_REGISTRY_ADDRESS: "0x1234" })).toMatch(/FARJI_REGISTRY_ADDRESS/);
    expect(errorsOf({ FARJI_REGISTRY_ADDRESS: "0x" + "0".repeat(40) })).toMatch(/non-zero/);
    expect(errorsOf({ FARJI_ADMIN_WALLET: "0xnotanaddress" })).toMatch(/FARJI_ADMIN_WALLET/);
    expect(SEPOLIA_CHAIN_ID).toBe(11155111);
  });

  it("a local setup is allowed in development mode only", () => {
    const local = { FARJI_CHAIN_ID: "31337", FARJI_FINALITY: "depth:2", FARJI_RPC_URL: "http://127.0.0.1:8545", NEXT_PUBLIC_APP_URL: "http://localhost:3000", FARJI_PUBLIC_URL: undefined, DATABASE_URL: "postgresql://u:p@localhost:5432/db" };
    expect(check(local, false).errors).toEqual([]);
    expect(check(local, true).errors.length).toBeGreaterThan(0);
  });

  it("the sync token must be long and not trivially repeated", () => {
    expect(errorsOf({ FARJI_SYNC_TOKEN: "a".repeat(40) })).toMatch(/FARJI_SYNC_TOKEN/);
    expect(errorsOf({ FARJI_SYNC_TOKEN: "x".repeat(16) })).toMatch(/32/);
  });

  it("a secret or service-role Supabase key is refused", () => {
    expect(errorsOf({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" })).toMatch(/service-role/);
  });

  it("private keys, mnemonics and service-role credentials may not exist at all", () => {
    for (const name of ["DEPLOYER_PRIVATE_KEY", "MNEMONIC", "SUPABASE_SERVICE_ROLE_KEY", "FARJI_SEED_PHRASE", "KEYSTORE_PASSWORD"]) {
      expect(errorsOf({ [name]: "anything" }), name).toContain(name);
    }
  });

  it("nothing sensitive may carry the browser prefix", () => {
    for (const name of ["NEXT_PUBLIC_DATABASE_URL", "NEXT_PUBLIC_FARJI_RPC_URL", "NEXT_PUBLIC_SYNC_TOKEN", "NEXT_PUBLIC_SERVICE_KEY"]) {
      expect(errorsOf({ [name]: "x" }), name).toContain("bundled into the browser");
    }
    expect(check({ NEXT_PUBLIC_SUPABASE_URL: good.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_APP_URL: good.NEXT_PUBLIC_APP_URL }).errors).toEqual([]);
  });

  it("the site URLs must be public https origins in production and agree with each other", () => {
    expect(errorsOf({ NEXT_PUBLIC_APP_URL: "http://farji.example" })).toMatch(/https/);
    expect(errorsOf({ NEXT_PUBLIC_APP_URL: "https://farji.example/app" })).toMatch(/origin only/);
    expect(errorsOf({ FARJI_PUBLIC_URL: "https://localhost" })).toMatch(/FARJI_PUBLIC_URL/);
    expect(check({ FARJI_PUBLIC_URL: "https://other.example" }).warnings.join(" ")).toMatch(/differ/);
    expect(check({ FARJI_PUBLIC_URL: undefined }).warnings.join(" ")).toMatch(/FARJI_PUBLIC_URL/);
  });
});

describe("public origin for share links, QR codes and evidence links", () => {
  const prod = (env: Record<string, string>, host = "evil.example") => resolvePublicOrigin({ env, production: true, host });

  it("FARJI_PUBLIC_URL is authoritative and a spoofed Host header is ignored", () => {
    expect(prod({ FARJI_PUBLIC_URL: "https://farji.example" })).toBe("https://farji.example");
    expect(resolvePublicOrigin({ env: { FARJI_PUBLIC_URL: "https://farji.example/" }, production: true, host: "attacker.example", forwardedHost: "attacker.example" })).toBe("https://farji.example");
  });

  it("in production it falls back to the platform host, then the auth site URL, before trusting the request", () => {
    expect(prod({ VERCEL_PROJECT_PRODUCTION_URL: "farji.vercel.app" })).toBe("https://farji.vercel.app");
    expect(prod({ NEXT_PUBLIC_APP_URL: "https://app.farji.example" })).toBe("https://app.farji.example");
    expect(prod({ FARJI_PUBLIC_URL: "http://insecure.example", NEXT_PUBLIC_APP_URL: "https://app.farji.example" })).toBe("https://app.farji.example");
  });

  it("development uses the request host (http on localhost)", () => {
    expect(resolvePublicOrigin({ env: {}, production: false, host: "localhost:3000" })).toBe("http://localhost:3000");
    expect(resolvePublicOrigin({ env: {}, production: false, host: "10.0.0.5:3000", forwardedProto: "http" })).toBe("http://10.0.0.5:3000");
    expect(resolvePublicOrigin({ env: {}, production: false, host: "bad host/../x" })).toBe("http://localhost:3000");
  });

  it("cleanOrigin accepts only a bare origin", () => {
    expect(cleanOrigin("https://farji.example/")).toBe("https://farji.example");
    for (const bad of ["https://farji.example/path", "https://u:p@farji.example", "ftp://x.example", "http://farji.example", "", "https://farji.example?x=1"]) expect(cleanOrigin(bad)).toBeNull();
  });

  it("the auth redirect base never silently becomes localhost in production", () => {
    expect(parseEnv({ NODE_ENV: "production", FARJI_PUBLIC_URL: "https://farji.example" }).appUrl).toBe("https://farji.example");
    expect(parseEnv({ NODE_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "farji.vercel.app" }).appUrl).toBe("https://farji.vercel.app");
    expect(parseEnv({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://x.example", FARJI_PUBLIC_URL: "https://y.example" }).appUrl).toBe("https://x.example");
    expect(parseEnv({}).appUrl).toBe("http://localhost:3000");
  });
});

describe("auth cookies", () => {
  it("are HttpOnly and SameSite=Lax always, and Secure in production", () => {
    expect(authCookieOptions(true)).toEqual({ path: "/", sameSite: "lax", httpOnly: true, secure: true });
    expect(authCookieOptions(false)).toMatchObject({ httpOnly: true, secure: false });
  });
});

describe("supported networks", () => {
  const base = { FARJI_RPC_URL: "https://rpc.example", FARJI_REGISTRY_ADDRESS: REGISTRY };

  it("Sepolia with the finalized tag is accepted", () => {
    const cfg = getChainConfig({ ...base, FARJI_CHAIN_ID: "11155111", FARJI_FINALITY: "finalized" });
    expect(cfg).toMatchObject({ chainId: 11155111n, finality: { mode: "finalized" }, registry: REGISTRY.toLowerCase() });
    expect(getChainConfig({ ...base, FARJI_CHAIN_ID: "11155111" }).finality).toEqual({ mode: "finalized" }); // default
  });

  it("depth-based finality is refused on Sepolia: depth:0 would treat a mined block as final", () => {
    for (const f of ["depth:0", "depth:2", "depth:64"]) expect(() => getChainConfig({ ...base, FARJI_CHAIN_ID: "11155111", FARJI_FINALITY: f })).toThrow(/finalized/);
  });

  it("local networks keep depth finality; mainnet and unknown networks are refused", () => {
    expect(getChainConfig({ ...base, FARJI_CHAIN_ID: "31337", FARJI_FINALITY: "depth:0" }).finality).toEqual({ mode: "depth", depth: 0 });
    for (const id of ["1", "10", "137", "8453"]) expect(() => getChainConfig({ ...base, FARJI_CHAIN_ID: id, FARJI_FINALITY: "finalized" })).toThrow(/not a supported network/);
  });
});

describe("rate limiting is an honest per-instance brake", () => {
  const rule = { name: "t", limit: 3, windowMs: 1000 };

  it("allows up to the limit, then refuses with a retry time, then recovers after the window", () => {
    const l = new RateLimiter();
    expect([1, 2, 3].map(() => l.check(rule, "a", 0).allowed)).toEqual([true, true, true]);
    const blocked = l.check(rule, "a", 100);
    expect(blocked).toMatchObject({ allowed: false, remaining: 0 });
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(l.check(rule, "a", 1001).allowed).toBe(true);
  });

  it("keys are independent and memory is bounded", () => {
    const l = new RateLimiter(50);
    for (let i = 0; i < 500; i++) l.check(rule, `k${i}`, 0);
    expect(l.size).toBeLessThanOrEqual(50);
    expect(l.check(rule, "fresh", 0).allowed).toBe(true);
  });

  it("covers the abuse-prone entry points", () => {
    expect(Object.keys(RULES).sort()).toEqual(["bundle", "importConfirm", "importPreview", "publicRead", "signIn", "signUp", "syncAuthFailure", "syncCall", "verifyLookup"]);
    expect(RULES.syncAuthFailure.limit).toBeLessThan(RULES.syncCall.limit);
  });

  it("brakes password guessing and account creation per caller (Phase 16)", () => {
    expect(RULES.signIn.limit).toBeLessThanOrEqual(10);
    expect(RULES.signIn.windowMs).toBeGreaterThanOrEqual(5 * 60_000);
    expect(RULES.signUp.limit).toBeLessThan(RULES.signIn.limit);
    const l = new RateLimiter();
    const attempts = Array.from({ length: RULES.signIn.limit + 1 }, () => l.check(RULES.signIn, "attacker", 0).allowed);
    expect(attempts.slice(0, -1).every(Boolean)).toBe(true);
    expect(attempts.at(-1)).toBe(false);
    expect(l.check(RULES.signIn, "someone-else", 0).allowed).toBe(true); // another caller is unaffected
  });

  it("the sign-in and sign-up actions apply the brake before contacting Supabase", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/auth/actions.ts", "utf8");
    const login = src.slice(src.indexOf("export async function loginAction"), src.indexOf("export async function signupAction"));
    const signup = src.slice(src.indexOf("export async function signupAction"), src.indexOf("export async function signOutAction"));
    expect(login.indexOf("RULES.signIn")).toBeGreaterThan(-1);
    expect(login.indexOf("RULES.signIn")).toBeLessThan(login.indexOf("signInWithPassword"));
    expect(signup.indexOf("RULES.signUp")).toBeGreaterThan(-1);
    expect(signup.indexOf("RULES.signUp")).toBeLessThan(signup.indexOf("performSignup"));
  });

  it("believes proxy headers only on a platform that sets them, and never stores the address", () => {
    const get = (n: string) => ({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "x-real-ip": "203.0.113.9" })[n];
    const onVercel = clientKeyFrom(get, { VERCEL: "1" });
    expect(onVercel).toMatch(/^[0-9a-f]{24}$/);
    expect(onVercel).not.toContain("203.0.113.9");
    expect(clientKeyFrom((n) => (n === "x-real-ip" ? "198.51.100.7" : null), { VERCEL: "1" })).not.toBe(onVercel);
    expect(clientKeyFrom(get, {})).toBe("shared"); // spoofable headers are ignored elsewhere
    expect(clientKeyFrom(() => null, { VERCEL: "1" })).toBe("shared");
  });
});
