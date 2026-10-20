import { headers } from "next/headers";

/**
 * The site's public origin for share links and QR codes. `FARJI_PUBLIC_URL` (e.g. https://farji.example) wins; otherwise the
 * request's own host is used. It only affects the link shown to the person viewing the page.
 */
export async function publicOrigin(): Promise<string> {
  const configured = process.env.FARJI_PUBLIC_URL;
  if (configured && /^https?:\/\/[^\s/]+$/.test(configured.replace(/\/$/, ""))) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return /^[A-Za-z0-9.\-:]+$/.test(host) ? `${proto}://${host}` : "http://localhost:3000";
}

export const profilePath = (handle: string) => `/p/${handle}`;
export const verifierPath = (credentialRef: string) => `/verify/${credentialRef}`;
