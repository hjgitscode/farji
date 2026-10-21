import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { authCookieOptions } from "../cookies";
import { getSupabaseEnv } from "../env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Session tokens live in HttpOnly cookies managed by @supabase/ssr (never localStorage).
 * Create a NEW client per request; never share one across requests.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseEnv();

  return createServerClient(url, publishableKey, {
    cookieOptions: authCookieOptions(process.env.NODE_ENV === "production"),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe to ignore:
          // proxy.ts refreshes the session cookies on every protected request.
        }
      },
    },
  });
}
