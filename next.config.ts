import type { NextConfig } from "next";
import path from "node:path";
import { securityHeaders } from "./config/security-headers";

// Response headers for every route, including the Content-Security-Policy (see config/security-headers.ts).
const headers = securityHeaders({ NODE_ENV: process.env.NODE_ENV, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL });

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
