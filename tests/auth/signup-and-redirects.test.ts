import { describe, expect, it, vi } from "vitest";
import { parseLoginForm, parseSignupForm, performSignup } from "@/lib/auth/forms";
import { loginUrlFor, resolvePostLoginPath, safeInternalPath } from "@/lib/auth/paths";
import { parseSupabaseEnv, SupabaseEnvError } from "@/lib/auth/env";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("2. signup cannot choose or inject a role", () => {
  it("ignores role / metadata fields in the submitted form", () => {
    const parsed = parseSignupForm(
      form({
        email: "New.User@Example.com",
        password: "correct horse battery",
        role: "ADMIN",
        user_metadata: '{"role":"ADMIN"}',
        organisationId: "x",
      }),
    );
    expect(parsed).toEqual({ ok: true, email: "new.user@example.com", password: "correct horse battery" });
  });

  it("sends only email, password and the redirect URL to Supabase — no `data`", async () => {
    const signUp = vi.fn().mockResolvedValue({ data: { session: null, user: {} }, error: null });
    const parsed = parseSignupForm(form({ email: "a@b.co", password: "password123", role: "ISSUER" }));
    if (!parsed.ok) throw new Error("expected valid form");

    const outcome = await performSignup({ auth: { signUp } }, parsed, "https://app.example/auth/callback");

    expect(outcome).toEqual({ kind: "CONFIRM_EMAIL" });
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(signUp).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "password123",
      options: { emailRedirectTo: "https://app.example/auth/callback" },
    });
    expect(JSON.stringify(signUp.mock.calls[0][0])).not.toMatch(/role|ISSUER|ADMIN|data/);
  });

  it("reports SIGNED_IN when Supabase returns a session, and a generic error otherwise", async () => {
    const ok = vi.fn().mockResolvedValue({ data: { session: {}, user: {} }, error: null });
    expect(await performSignup({ auth: { signUp: ok } }, { email: "a@b.co", password: "password123" }, "https://x")).toEqual({ kind: "SIGNED_IN" });

    const bad = vi.fn().mockResolvedValue({ data: { session: null, user: null }, error: { message: "User already registered: internal detail" } });
    const outcome = await performSignup({ auth: { signUp: bad } }, { email: "a@b.co", password: "password123" }, "https://x");
    expect(outcome.kind).toBe("ERROR");
    expect(JSON.stringify(outcome)).not.toMatch(/already registered|internal/);
  });

  it("validates email and password length", () => {
    expect(parseSignupForm(form({ email: "nope", password: "password123" })).ok).toBe(false);
    expect(parseSignupForm(form({ email: "a@b.co", password: "short" })).ok).toBe(false);
  });

  it("login parsing also ignores role fields", () => {
    const parsed = parseLoginForm(form({ email: "a@b.co", password: "x", role: "ADMIN", next: "/candidate" }));
    expect(parsed).toMatchObject({ ok: true, email: "a@b.co", next: "/candidate" });
    expect(parsed).not.toHaveProperty("role");
  });
});

describe("open-redirect protection", () => {
  it.each([
    "https://evil.example",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "/candidate/../admin",
    "/candidate?x=https://evil.example",
    "/%2F%2Fevil.example",
    "candidate",
    "",
    " /candidate",
  ])("rejects %j", (value) => {
    expect(safeInternalPath(value)).toBeNull();
  });

  it("accepts plain internal paths", () => {
    expect(safeInternalPath("/candidate")).toBe("/candidate");
    expect(safeInternalPath("/issuer/requests")).toBe("/issuer/requests");
  });

  it("redirects to the database role's home, honouring `next` only inside that role's area", () => {
    expect(resolvePostLoginPath("CANDIDATE", undefined)).toBe("/candidate");
    expect(resolvePostLoginPath("ISSUER", undefined)).toBe("/issuer");
    expect(resolvePostLoginPath("ADMIN", undefined)).toBe("/admin");
    expect(resolvePostLoginPath("CANDIDATE", "/candidate/profile")).toBe("/candidate/profile");
    expect(resolvePostLoginPath("CANDIDATE", "/admin")).toBe("/candidate");
    expect(resolvePostLoginPath("ISSUER", "/admin/orgs")).toBe("/issuer");
    expect(resolvePostLoginPath("ADMIN", "https://evil.example")).toBe("/admin");
  });

  it("builds a login URL only with a safe return path", () => {
    expect(loginUrlFor("/candidate")).toBe("/login?next=%2Fcandidate");
    expect(loginUrlFor("https://evil.example")).toBe("/login");
    expect(loginUrlFor(null)).toBe("/login");
  });
});

describe("supabase environment validation", () => {
  const key = "sb_publishable_abc";
  it("accepts an https URL and a publishable key", () => {
    expect(parseSupabaseEnv({ url: "https://abc.supabase.co", publishableKey: key })).toEqual({ url: "https://abc.supabase.co", publishableKey: key });
  });

  it("allows http only for localhost", () => {
    expect(() => parseSupabaseEnv({ url: "http://localhost:54321", publishableKey: key })).not.toThrow();
    expect(() => parseSupabaseEnv({ url: "http://abc.supabase.co", publishableKey: key })).toThrow(SupabaseEnvError);
  });

  it("rejects missing values", () => {
    expect(() => parseSupabaseEnv({})).toThrow(SupabaseEnvError);
  });

  it("refuses secret / service-role keys", () => {
    expect(() => parseSupabaseEnv({ url: "https://abc.supabase.co", publishableKey: "sb_secret_abc" })).toThrow(/secret/);
    const jwt = (role: string) =>
      ["h", Buffer.from(JSON.stringify({ role })).toString("base64url"), "s"].join(".");
    expect(() => parseSupabaseEnv({ url: "https://abc.supabase.co", publishableKey: jwt("service_role") })).toThrow(/secret/);
    expect(() => parseSupabaseEnv({ url: "https://abc.supabase.co", publishableKey: jwt("anon") })).not.toThrow();
  });
});
