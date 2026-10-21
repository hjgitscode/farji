import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { RateLimiter, type RateDecision, type RateRule } from "@/lib/security/rate-limit";

// Applies the per-instance limiter (lib/security/rate-limit.ts) to a request. See that file for what this does NOT promise.

const g = globalThis as unknown as { farjiLimiter?: RateLimiter };
const limiter = () => (g.farjiLimiter ??= new RateLimiter());

/**
 * A stable, non-reversible key for the caller. Proxy headers are believed ONLY on a platform that sets them (Vercel); anywhere
 * else a client could spoof them, so all callers share one bucket instead. The raw address is never stored.
 */
export function clientKeyFrom(get: (name: string) => string | null | undefined, env: Record<string, string | undefined> = process.env): string {
  const trusted = env.VERCEL === "1" || env.FARJI_TRUST_PROXY === "1";
  const ip = trusted ? (get("x-real-ip") ?? get("x-forwarded-for")?.split(",")[0] ?? "") : "";
  const cleaned = ip.trim().slice(0, 64);
  return cleaned ? createHash("sha256").update(cleaned).digest("hex").slice(0, 24) : "shared";
}

export async function requestKey(): Promise<string> {
  const h = await headers();
  return clientKeyFrom((n) => h.get(n));
}

export function checkLimit(rule: RateRule, key: string, nowMs: number = Date.now()): RateDecision {
  return limiter().check(rule, key, nowMs);
}

/** Convenience for route handlers: the caller's key from a Request. */
export function requestKeyFrom(request: Request): string {
  return clientKeyFrom((n) => request.headers.get(n));
}
