// Response security headers for every route (Phase 16). Pure: the environment is passed in, nothing is read here.
//
// What the browser actually needs (verified in Phase 16, see docs/PHASE16_SECURITY.md):
//   - scripts and styles: only FARJI's own origin. Next.js App Router also emits inline bootstrap scripts and inline styles,
//     so 'unsafe-inline' is kept for script-src/style-src. A nonce-based policy would force every page to render dynamically
//     (including the public static pages) and is recorded as a deferred hardening step, not silently half-done.
//   - network (connect-src): FARJI's own origin. Sign-in, data and chain reads all go through FARJI's server; the browser
//     Supabase client is not used. The Supabase project origin is still allowed so a future client-side auth call cannot
//     break silently. The browser wallet (MetaMask) talks to its own RPC from the extension, which page CSP does not govern.
//   - images: own origin plus data:/blob: (the QR code is inline SVG markup, not an image request).
//   - framing: none (frame-ancestors 'none' plus X-Frame-Options DENY for older browsers).

export type SecurityHeaderEnv = { NODE_ENV?: string; NEXT_PUBLIC_SUPABASE_URL?: string };

/** The https origin of the Supabase project, or null if it is missing or not a plain https URL. */
export function supabaseOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password ? u.origin : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(env: SecurityHeaderEnv): string {
  const dev = env.NODE_ENV !== "production";
  const supabase = supabaseOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const connect = ["'self'", ...(supabase ? [supabase, supabase.replace(/^https:/, "wss:")] : []), ...(dev ? ["ws:", "wss:"] : [])];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-eval' only in development: React's dev build needs it for call-stack reconstruction; production never does.
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connect,
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

export function securityHeaders(env: SecurityHeaderEnv): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}
