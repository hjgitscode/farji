import type { NextConfig } from "next";
import path from "node:path";

// Baseline response headers for every route. A strict Content-Security-Policy is deliberately not set here: Next.js inlines
// scripts and styles, and a nonce-based policy needs per-request middleware work that belongs with the Phase 16 review.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
