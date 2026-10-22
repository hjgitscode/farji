// Fixed-window rate limiter (ROADMAP Phase 14). PURE: the clock is passed in.
//
// HONEST SCOPE. The counters live in the memory of ONE server instance. On a serverless platform each instance has its own
// counters and they vanish when the instance is recycled, so this limiter is a best-effort brake on bursts hitting a warm
// instance (a script hammering one endpoint), NOT a distributed or durable limit. A global limit is the platform's job (a
// Vercel Firewall rate-limit rule; see docs/DEPLOYMENT.md). It exists in addition to defensive design: unguessable 32-byte
// credential references, identical 404s for private/unknown, no listings, and bounded import sizes.

export type RateRule = { name: string; limit: number; windowMs: number };
export type RateDecision = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly maxKeys = 5000) {}

  check(rule: RateRule, key: string, nowMs: number): RateDecision {
    const k = `${rule.name}:${key}`;
    let entry = this.hits.get(k);
    if (!entry || entry.resetAt <= nowMs) {
      if (this.hits.size >= this.maxKeys) this.prune(nowMs);
      entry = { count: 0, resetAt: nowMs + rule.windowMs };
      this.hits.set(k, entry);
    }
    entry.count += 1;
    const allowed = entry.count <= rule.limit;
    return { allowed, remaining: Math.max(0, rule.limit - entry.count), retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((entry.resetAt - nowMs) / 1000)) };
  }

  /** Drops expired windows; if still full, drops the oldest so memory stays bounded. */
  private prune(nowMs: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= nowMs) this.hits.delete(k);
    while (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
  }

  get size() {
    return this.hits.size;
  }
}

/** The limits applied to public and abuse-prone entry points. */
export const RULES = {
  /** Pasting a link/reference into the verifier. */
  verifyLookup: { name: "verify-lookup", limit: 20, windowMs: 60_000 },
  /** Opening a verifier page or a public profile. */
  publicRead: { name: "public-read", limit: 120, windowMs: 60_000 },
  /** Downloading the evidence bundle (heavier: replays the ProofPulse log). */
  bundle: { name: "bundle", limit: 20, windowMs: 60_000 },
  /** Any call to the scheduled sync endpoint. */
  syncCall: { name: "sync-call", limit: 30, windowMs: 60_000 },
  /** Failed authentication on the sync endpoint (guessing the token). */
  syncAuthFailure: { name: "sync-auth-failure", limit: 5, windowMs: 10 * 60_000 },
  /** Import preview / confirm, per signed-in candidate. */
  importPreview: { name: "import-preview", limit: 12, windowMs: 60_000 },
  importConfirm: { name: "import-confirm", limit: 10, windowMs: 60_000 },
  /**
   * Password sign-in attempts per client (Phase 16). Sign-in is called from FARJI's server, so Supabase's own per-IP limits
   * see the platform's address rather than the caller's: this brake is the only per-caller one.
   */
  signIn: { name: "sign-in", limit: 10, windowMs: 5 * 60_000 },
  /** Account creation per client (Phase 16), for the same reason. */
  signUp: { name: "sign-up", limit: 5, windowMs: 10 * 60_000 },
} as const satisfies Record<string, RateRule>;
