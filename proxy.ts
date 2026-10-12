import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath, loginUrlFor } from "@/lib/auth/paths";
import { updateSession } from "@/lib/auth/supabase/proxy";

// Next.js 16 `proxy` (formerly middleware). Responsibilities:
//   1. refresh the Supabase session cookies for the routes that read them;
//   2. optimistically send visitors without a session away from private areas.
// This is NOT the authorization boundary. Role and organisation checks are enforced
// server-side by lib/auth/guards.ts in every private layout and page.
export async function proxy(request: NextRequest) {
  const { response, hasUser } = await updateSession(request);

  if (!hasUser && isProtectedPath(request.nextUrl.pathname)) {
    const redirect = NextResponse.redirect(new URL(loginUrlFor(request.nextUrl.pathname), request.url));
    // Keep any cookies the refresh step cleared or rotated.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}

// Public pages (/, /verify, …) never run the proxy, so they stay static and unauthenticated.
export const config = {
  matcher: ["/candidate/:path*", "/issuer/:path*", "/admin/:path*", "/login", "/signup", "/auth/:path*"],
};
