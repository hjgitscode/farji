// Which origin permanent share links, QR codes and evidence links use (ROADMAP Phase 14). PURE.
//
// Order, first valid wins:
//   1. FARJI_PUBLIC_URL        - the operator's explicit, authoritative base URL;
//   2. VERCEL_PROJECT_PRODUCTION_URL (production only) - set by the platform, not by the request;
//   3. NEXT_PUBLIC_APP_URL     (production only, when it is a public https origin) - the auth site URL;
//   4. the request's own host  - development and last resort. A Host header is attacker-influenceable, so in production this is
//      reached only when nothing above is configured (the env validation reports that as a warning).

type Env = Record<string, string | undefined>;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;

/** A clean origin (scheme + host[:port]) or null. Rejects paths, queries, credentials and plain http outside localhost. */
export function cleanOrigin(raw: string | undefined, opts: { requireHttps?: boolean } = {}): string | null {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!v) return null;
  try {
    const u = new URL(v);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.pathname !== "/" || u.search || u.hash || u.username || u.password) return null;
    const local = LOCAL_HOST.test(u.host);
    if (u.protocol === "http:" && !local) return null;
    if (opts.requireHttps && (u.protocol !== "https:" || local)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export type OriginInput = {
  env: Env;
  production: boolean;
  host?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
};

export function resolvePublicOrigin(i: OriginInput): string {
  const explicit = cleanOrigin(i.env.FARJI_PUBLIC_URL, { requireHttps: i.production });
  if (explicit) return explicit;

  if (i.production) {
    const platformHost = (i.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const platform = platformHost ? cleanOrigin(`https://${platformHost}`, { requireHttps: true }) : null;
    if (platform) return platform;
    const app = cleanOrigin(i.env.NEXT_PUBLIC_APP_URL, { requireHttps: true });
    if (app) return app;
  }

  const host = (i.forwardedHost ?? i.host ?? "localhost:3000").split(",")[0].trim();
  const safeHost = /^[A-Za-z0-9.\-:]+$/.test(host) ? host : "localhost:3000";
  const proto = LOCAL_HOST.test(safeHost) ? "http" : i.forwardedProto?.split(",")[0].trim() === "http" && !i.production ? "http" : "https";
  return `${proto}://${safeHost}`;
}
