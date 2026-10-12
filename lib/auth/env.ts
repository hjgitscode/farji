// Supabase configuration. Only PUBLIC credentials are ever read here: the project URL
// and the publishable (or legacy anon) key. A service-role / secret key must never be
// configured for the web app, and is rejected if it appears in these variables.

export type SupabaseEnv = {
  url: string;
  publishableKey: string;
};

export class SupabaseEnvError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid Supabase configuration: ${problems.join("; ")}`);
    this.name = "SupabaseEnvError";
    this.problems = problems;
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Returns the role claim of a JWT-shaped key without verifying it, or null. */
function jwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** Pure validation. Takes the raw values so it can be tested without process.env. */
export function parseSupabaseEnv(raw: { url?: string; publishableKey?: string }): SupabaseEnv {
  const problems: string[] = [];
  const url = raw.url?.trim() ?? "";
  const key = raw.publishableKey?.trim() ?? "";

  if (!url) {
    problems.push("NEXT_PUBLIC_SUPABASE_URL is not set");
  } else {
    try {
      const parsed = new URL(url);
      const secure = parsed.protocol === "https:" || (parsed.protocol === "http:" && isLocalHost(parsed.hostname));
      if (!secure) problems.push("NEXT_PUBLIC_SUPABASE_URL must be https (http is allowed for localhost only)");
    } catch {
      problems.push("NEXT_PUBLIC_SUPABASE_URL must be a valid URL");
    }
  }

  if (!key) {
    problems.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set");
  } else if (key.startsWith("sb_secret_") || jwtRole(key) === "service_role") {
    problems.push("a Supabase secret / service-role key must never be used here; use the publishable key");
  }

  if (problems.length > 0) throw new SupabaseEnvError(problems);
  return { url, publishableKey: key };
}

/**
 * NEXT_PUBLIC_* variables are inlined at build time only when referenced literally,
 * so each one is read explicitly. The legacy anon key name is accepted as a fallback.
 */
export function getSupabaseEnv(): SupabaseEnv {
  return parseSupabaseEnv({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
