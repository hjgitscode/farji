// Cookie attributes for the Supabase auth session (ROADMAP Phase 14). PURE.
//
// The session is created and read ONLY on the server (server actions, route handlers, proxy.ts); no FARJI code runs the
// Supabase browser client. The library default is `httpOnly: false` (so a browser client could read the cookie), which would
// let any injected script read the session. We therefore set HttpOnly, SameSite=Lax and Secure in production.

export type AuthCookieOptions = { path: string; sameSite: "lax"; httpOnly: true; secure: boolean };

export function authCookieOptions(production: boolean): AuthCookieOptions {
  return { path: "/", sameSite: "lax", httpOnly: true, secure: production };
}
