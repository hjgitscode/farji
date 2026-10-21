import { headers } from "next/headers";
import { resolvePublicOrigin } from "@/lib/core/public-origin";

/**
 * The site's public origin for share links and QR codes. `FARJI_PUBLIC_URL` is authoritative when configured; the request
 * host is only a development fallback (see lib/core/public-origin.ts for the exact order).
 */
export async function publicOrigin(): Promise<string> {
  const h = await headers();
  return resolvePublicOrigin({
    env: process.env,
    production: process.env.NODE_ENV === "production",
    host: h.get("host"),
    forwardedHost: h.get("x-forwarded-host"),
    forwardedProto: h.get("x-forwarded-proto"),
  });
}

export const profilePath = (handle: string) => `/p/${handle}`;
export const verifierPath = (credentialRef: string) => `/verify/${credentialRef}`;
