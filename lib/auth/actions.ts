"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/database/client";
import { loadActor } from "./authorize";
import { getEnv } from "@/lib/core/env";
import { parseLoginForm, parseSignupForm, performSignup } from "./forms";
import { getVerifiedAuthUserId } from "./identity";
import { resolvePostLoginPath, ROLE_HOME } from "./paths";
import { createSupabaseServerClient } from "./supabase/server";

export type AuthFormState = { error?: string; message?: string };

const SIGN_IN_FAILED = "Invalid email or password.";
const ACCOUNT_UNAVAILABLE = "This account cannot sign in. Contact support if you think this is a mistake.";
const GENERIC_FAILURE = "Something went wrong. Please try again.";

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = parseLoginForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  let destination: string;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email: parsed.email, password: parsed.password });
    if (error) return { error: SIGN_IN_FAILED }; // same message for unknown email and wrong password

    const load = await loadActor(await getVerifiedAuthUserId(supabase), getDb());
    if (load.status !== "OK") {
      await supabase.auth.signOut();
      return { error: ACCOUNT_UNAVAILABLE };
    }
    // The destination comes from the FARJI database role. `next` is honoured only if it
    // is a safe path inside that role's own area.
    destination = resolvePostLoginPath(load.actor.role, parsed.next);
  } catch {
    return { error: GENERIC_FAILURE };
  }
  redirect(destination);
}

export async function signupAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  // Only email + password are read. Any `role` or other field in the request is ignored.
  const parsed = parseSignupForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  try {
    const supabase = await createSupabaseServerClient();
    const outcome = await performSignup(supabase, parsed, `${getEnv().appUrl}/auth/callback`);

    if (outcome.kind === "ERROR") return { error: outcome.message };
    if (outcome.kind === "CONFIRM_EMAIL") {
      return { message: "Check your email to confirm your account, then sign in." };
    }

    // Email confirmation is disabled in this project: the user is already signed in.
    const load = await loadActor(await getVerifiedAuthUserId(supabase), getDb()); // creates CANDIDATE row
    if (load.status !== "OK") return { error: GENERIC_FAILURE };
  } catch {
    return { error: GENERIC_FAILURE };
  }
  redirect(ROLE_HOME.CANDIDATE);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
