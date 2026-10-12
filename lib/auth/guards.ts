import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/database/client";
import { loadActor, type ActorLoad } from "./authorize";
import { createGuards } from "./guard-core";
import { getVerifiedAuthUserId } from "./identity";
import { createSupabaseServerClient } from "./supabase/server";

/**
 * Server-side guards. Call the matching guard in EVERY private layout and page (and,
 * later, every server action). A layout check alone is not enough: layouts do not
 * re-render on client navigation and do not stop their child pages from rendering.
 */

/** Resolves the current request's actor (null-safe, no redirect). Cached per request. */
export const getAuthenticatedUser = cache(async (): Promise<ActorLoad> => {
  const supabase = await createSupabaseServerClient();
  const authUserId = await getVerifiedAuthUserId(supabase);
  return loadActor(authUserId, getDb());
});

export const { requireAuthenticatedUser, requireCandidate, requireIssuer, requireAdmin } = createGuards(
  getAuthenticatedUser,
  redirect,
);
