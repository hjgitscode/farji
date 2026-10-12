import { NextResponse, type NextRequest } from "next/server";
import { loadActor } from "@/lib/auth/authorize";
import { getVerifiedAuthUserId } from "@/lib/auth/identity";
import { resolvePostLoginPath } from "@/lib/auth/paths";
import { createSupabaseServerClient } from "@/lib/auth/supabase/server";
import { getDb } from "@/lib/database/client";

export const dynamic = "force-dynamic";

// Email-confirmation landing (PKCE). Exchanges the one-time code for a session, creates
// the FARJI user row if needed, then sends the user to the home of their DATABASE role.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const failure = NextResponse.redirect(new URL("/login?error=confirmation", origin));

  const code = searchParams.get("code");
  if (!code) return failure;

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure;

    const load = await loadActor(await getVerifiedAuthUserId(supabase), getDb());
    if (load.status !== "OK") {
      await supabase.auth.signOut();
      return failure;
    }
    // Redirect target is built from our own origin + a validated, role-scoped path.
    return NextResponse.redirect(new URL(resolvePostLoginPath(load.actor.role, searchParams.get("next")), origin));
  } catch {
    return failure;
  }
}
