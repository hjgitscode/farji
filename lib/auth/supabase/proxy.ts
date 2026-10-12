import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "../env";

/**
 * Refreshes the Supabase session on the way in and returns whether a valid user exists.
 * Used only by proxy.ts. The result is an OPTIMISTIC check for redirects; real
 * authorization happens in the server-side guards (lib/auth/guards.ts).
 */
export async function updateSession(request: NextRequest): Promise<{ response: NextResponse; hasUser: boolean }> {
  const { url, publishableKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // getUser() validates the token with the Supabase Auth server (unlike getSession()).
  const { data, error } = await supabase.auth.getUser();
  return { response, hasUser: !error && !!data.user };
}
