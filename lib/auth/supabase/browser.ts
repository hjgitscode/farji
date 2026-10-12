"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "../env";

/**
 * Browser Supabase client (publishable key only). Phase 3 performs sign-in, sign-up and
 * sign-out through server actions, so no component uses this yet; it exists for later
 * client-side needs. It must never be used to make authorization decisions.
 */
export function createSupabaseBrowserClient() {
  const { url, publishableKey } = getSupabaseEnv();
  return createBrowserClient(url, publishableKey);
}
