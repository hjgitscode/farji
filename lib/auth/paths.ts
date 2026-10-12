// Pure path rules: role homes, protected areas and open-redirect-safe `next` handling.

export type AppRole = "CANDIDATE" | "ISSUER" | "ADMIN";

export const ROLE_HOME: Record<AppRole, string> = {
  CANDIDATE: "/candidate",
  ISSUER: "/issuer",
  ADMIN: "/admin",
};

/** Private areas. Everything under these prefixes requires the matching role. */
export const PROTECTED_PREFIXES = ["/candidate", "/issuer", "/admin"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Which role owns a private path, or null for public paths. */
export function requiredRoleForPath(pathname: string): AppRole | null {
  for (const role of Object.keys(ROLE_HOME) as AppRole[]) {
    const prefix = ROLE_HOME[role];
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return role;
  }
  return null;
}

const SAFE_PATH = /^\/[A-Za-z0-9\-._~/]*$/;

/**
 * Accepts only a same-site absolute PATH (no query, no scheme, no host, no `//`,
 * no backslashes, no encoded tricks). Anything else returns null.
 */
export function safeInternalPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return null;
  if (!SAFE_PATH.test(value)) return null;
  if (value.startsWith("//") || value.includes("..")) return null;
  return value;
}

/**
 * Where to send a user after sign-in. `next` is honoured only if it is a safe internal
 * path inside the user's OWN role area; otherwise they land on their role home.
 */
export function resolvePostLoginPath(role: AppRole, next: unknown): string {
  const safe = safeInternalPath(next);
  if (safe && requiredRoleForPath(safe) === role) return safe;
  return ROLE_HOME[role];
}

/** Login URL for an unauthenticated visitor, carrying a validated return path. */
export function loginUrlFor(nextPath: string | null | undefined): string {
  const safe = safeInternalPath(nextPath);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}
