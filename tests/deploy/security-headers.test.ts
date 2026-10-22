import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders, supabaseOrigin } from "../../config/security-headers";

// Phase 16: the Content-Security-Policy and baseline headers. Parsed per directive so a regression is precise.
const parse = (csp: string) => Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
const SUPABASE = "https://abcdefghijklmnop.supabase.co";
const prod = parse(contentSecurityPolicy({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: SUPABASE }));

describe("content security policy (production)", () => {
  it("locks every fetch type to FARJI's own origin by default", () => {
    expect(prod["default-src"]).toEqual(["'self'"]);
    expect(prod["object-src"]).toEqual(["'none'"]);
    expect(prod["base-uri"]).toEqual(["'self'"]);
    expect(prod["form-action"]).toEqual(["'self'"]);
  });

  it("cannot be framed and frames nothing (clickjacking)", () => {
    expect(prod["frame-ancestors"]).toEqual(["'none'"]);
    expect(prod["frame-src"]).toEqual(["'none'"]);
  });

  it("loads scripts only from FARJI and never allows eval in production", () => {
    expect(prod["script-src"]).toContain("'self'");
    expect(prod["script-src"]).not.toContain("'unsafe-eval'");
    expect(prod["script-src"].every((s: string) => s.startsWith("'"))).toBe(true); // no third-party script host
  });

  it("allows network calls only to FARJI and the configured Supabase project", () => {
    expect(prod["connect-src"]).toEqual(["'self'", SUPABASE, "wss://abcdefghijklmnop.supabase.co"]);
    expect(prod["connect-src"]).not.toContain("ws:");
    expect(prod["connect-src"]).not.toContain("*");
  });

  it("allows inline-SVG/data images for the QR code but no remote image host", () => {
    expect(prod["img-src"]).toEqual(["'self'", "data:", "blob:"]);
  });

  it("is never widened by a malformed or credentialed Supabase URL", () => {
    expect(supabaseOrigin("http://insecure.example")).toBeNull();
    expect(supabaseOrigin("https://user:pw@evil.example")).toBeNull();
    expect(supabaseOrigin("not a url")).toBeNull();
    expect(supabaseOrigin(undefined)).toBeNull();
    expect(supabaseOrigin("https://x.supabase.co/auth/v1?y=1")).toBe("https://x.supabase.co");
    expect(parse(contentSecurityPolicy({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "javascript:alert(1)" }))["connect-src"]).toEqual(["'self'"]);
  });

  it("development additionally allows eval and websockets for the dev server only", () => {
    const dev = parse(contentSecurityPolicy({ NODE_ENV: "development" }));
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["connect-src"]).toEqual(expect.arrayContaining(["ws:", "wss:"]));
  });
});

describe("baseline headers", () => {
  const h = Object.fromEntries(securityHeaders({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: SUPABASE }).map((x) => [x.key, x.value]));
  it("sets the full set with safe values", () => {
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d{8,}/);
    expect(h["Permissions-Policy"]).toMatch(/camera=\(\)/);
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });
});
