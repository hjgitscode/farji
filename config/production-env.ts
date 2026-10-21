import { isAddress } from "ethers";
import { parseSupabaseEnv } from "../lib/auth/env";

// Production environment validation (ROADMAP Phase 14). PURE: takes the environment as input and returns problems described by
// variable NAME only. A value is never copied into a message, so a report is safe to print or log.
//
// FARJI never holds a private key, so any variable that looks like one (or a database/service secret exposed under a browser
// prefix) is reported as an error rather than ignored.

/** Chains FARJI will talk to: local development networks and Sepolia. Ethereum mainnet is deliberately NOT supported. */
export const LOCAL_CHAIN_IDS: readonly number[] = [31337, 1337];
export const PUBLIC_CHAIN_IDS: readonly number[] = [11155111];
export const SEPOLIA_CHAIN_ID = 11155111;

export type EnvReport = { errors: string[]; warnings: string[] };
type Env = Record<string, string | undefined>;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;

const val = (env: Env, name: string) => (env[name] ?? "").trim();

function originProblem(name: string, raw: string, production: boolean): string | null {
  try {
    const u = new URL(raw);
    if (u.pathname !== "/" || u.search || u.hash || u.username) return `${name} must be an origin only (scheme and host, no path, query or credentials)`;
    if (production && (u.protocol !== "https:" || LOCAL_HOST.test(u.hostname))) return `${name} must be a public https origin in production`;
    if (u.protocol !== "https:" && u.protocol !== "http:") return `${name} must be an http(s) origin`;
    return null;
  } catch {
    return `${name} is not a valid URL`;
  }
}

/** Environment variable NAMES that must never exist in a FARJI runtime (the server never holds keys). */
const FORBIDDEN_NAME = /(PRIVATE_KEY|MNEMONIC|SEED_PHRASE|SERVICE_ROLE|SECRET_KEY|DEPLOYER_KEY|KEYSTORE_PASSWORD)/i;
/** NEXT_PUBLIC_* values are inlined into the browser bundle: nothing sensitive may carry that prefix. */
const SENSITIVE_PUBLIC_NAME = /(SECRET|PRIVATE|SERVICE|PASSWORD|TOKEN|DATABASE|DB_|RPC|SYNC|MNEMONIC)/i;

export function validateProductionEnv(env: Env, opts: { production?: boolean } = {}): EnvReport {
  const production = opts.production ?? true;
  const errors: string[] = [];
  const warnings: string[] = [];
  const need = (name: string) => {
    const v = val(env, name);
    if (!v) errors.push(`${name} is not set`);
    return v;
  };

  // ── database ──
  const db = need("DATABASE_URL");
  if (db) {
    if (!/^postgres(ql)?:\/\//i.test(db)) errors.push("DATABASE_URL must be a postgres:// connection string");
    else {
      try {
        const host = new URL(db).hostname;
        if (production && LOCAL_HOST.test(host)) errors.push("DATABASE_URL points at a local database in production");
        if (!/pooler\.supabase\.com$/i.test(host) && !LOCAL_HOST.test(host)) warnings.push("DATABASE_URL does not look like the Supabase pooled connection; serverless needs the pooler");
      } catch {
        errors.push("DATABASE_URL is not a valid URL");
      }
    }
  }
  if (!val(env, "DIRECT_URL")) warnings.push("DIRECT_URL is not set (only needed to run migrations, not at runtime)");

  // ── Supabase Auth (public values only) ──
  try {
    parseSupabaseEnv({ url: env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY });
  } catch (e) {
    for (const p of (e as { problems?: string[] }).problems ?? ["Supabase configuration is invalid"]) errors.push(p);
  }

  // ── site URL / share links ──
  const app = val(env, "NEXT_PUBLIC_APP_URL");
  if (!app) errors.push("NEXT_PUBLIC_APP_URL is not set (used for email confirmation links)");
  else {
    const p = originProblem("NEXT_PUBLIC_APP_URL", app, production);
    if (p) errors.push(p);
  }
  const pub = val(env, "FARJI_PUBLIC_URL");
  if (!pub) warnings.push("FARJI_PUBLIC_URL is not set; share links and QR codes fall back to the platform host");
  else {
    const p = originProblem("FARJI_PUBLIC_URL", pub, production);
    if (p) errors.push(p);
    else if (app && new URL(pub).origin !== new URL(app).origin) warnings.push("FARJI_PUBLIC_URL and NEXT_PUBLIC_APP_URL differ; they should name the same site");
  }

  // ── chain ──
  const chainRaw = need("FARJI_CHAIN_ID");
  let chainId: number | null = null;
  if (chainRaw) {
    if (!/^[1-9][0-9]{0,15}$/.test(chainRaw)) errors.push("FARJI_CHAIN_ID must be a positive integer");
    else {
      chainId = Number(chainRaw);
      if (chainId === 1) errors.push("FARJI_CHAIN_ID is Ethereum mainnet, which FARJI does not support; use Sepolia (11155111)");
      else if (!LOCAL_CHAIN_IDS.includes(chainId) && !PUBLIC_CHAIN_IDS.includes(chainId)) errors.push("FARJI_CHAIN_ID is not a supported network (Sepolia 11155111, or a local network)");
      else if (production && LOCAL_CHAIN_IDS.includes(chainId)) errors.push("FARJI_CHAIN_ID is a local development network in a production environment");
    }
  }
  const registry = need("FARJI_REGISTRY_ADDRESS");
  if (registry && (!isAddress(registry) || registry.toLowerCase() === ZERO_ADDRESS)) errors.push("FARJI_REGISTRY_ADDRESS must be a valid, non-zero address");

  const rpc = need("FARJI_RPC_URL");
  if (rpc) {
    try {
      const u = new URL(rpc);
      if (u.protocol !== "https:" && u.protocol !== "http:") errors.push("FARJI_RPC_URL must be an http(s) JSON-RPC URL");
      else if (chainId !== null && PUBLIC_CHAIN_IDS.includes(chainId) && (u.protocol !== "https:" || LOCAL_HOST.test(u.hostname))) errors.push("FARJI_RPC_URL must be a public https endpoint for a public network");
    } catch {
      errors.push("FARJI_RPC_URL is not a valid URL");
    }
  }

  const fin = val(env, "FARJI_FINALITY") || "finalized";
  if (fin !== "finalized" && !/^depth:\d{1,3}$/.test(fin)) errors.push('FARJI_FINALITY must be "finalized" or "depth:N"');
  else if (chainId !== null && PUBLIC_CHAIN_IDS.includes(chainId) && fin !== "finalized") errors.push('FARJI_FINALITY must be "finalized" on a public network (depth-based finality is for local networks only)');
  if (!val(env, "FARJI_FINALITY")) warnings.push('FARJI_FINALITY is not set; "finalized" is assumed');

  const admin = val(env, "FARJI_ADMIN_WALLET");
  if (admin && !isAddress(admin)) errors.push("FARJI_ADMIN_WALLET must be a valid address (a public address, never a key)");
  if (!admin) warnings.push("FARJI_ADMIN_WALLET is not set (only used by the deployment script)");

  // ── scheduled sync ──
  const token = need("FARJI_SYNC_TOKEN");
  if (token && (token.length < 32 || /^(.)\1+$/.test(token))) errors.push("FARJI_SYNC_TOKEN must be at least 32 random characters");

  // ── nothing key-like, nothing sensitive under a browser prefix ──
  for (const name of Object.keys(env)) {
    if (!val(env, name)) continue;
    if (FORBIDDEN_NAME.test(name)) errors.push(`${name} must not exist: FARJI servers never hold private keys or service-role credentials`);
    if (name.startsWith("NEXT_PUBLIC_") && SENSITIVE_PUBLIC_NAME.test(name)) errors.push(`${name} would be bundled into the browser; remove the NEXT_PUBLIC_ prefix`);
  }
  return { errors, warnings };
}
