// Parsing of auth form input. Allowlist only: email, password (and `next` for login).
// Any other field a client sends — `role`, `user_metadata`, `organisationId`, … — is
// ignored, so signup input can never choose or inject ISSUER / ADMIN.

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export type ParsedCredentials = { ok: true; email: string; password: string } | { ok: false; error: string };

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

export function parseLoginForm(formData: FormData): ParsedCredentials & { next: string } {
  const email = text(formData, "email").trim().toLowerCase();
  const password = text(formData, "password");
  const next = text(formData, "next");
  if (!EMAIL.test(email) || password.length === 0 || password.length > PASSWORD_MAX) {
    return { ok: false, error: "Enter a valid email and password.", next };
  }
  return { ok: true, email, password, next };
}

export function parseSignupForm(formData: FormData): ParsedCredentials {
  const email = text(formData, "email").trim().toLowerCase();
  const password = text(formData, "password");
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (password.length < PASSWORD_MIN) return { ok: false, error: `Use a password of at least ${PASSWORD_MIN} characters.` };
  if (password.length > PASSWORD_MAX) return { ok: false, error: "That password is too long." };
  return { ok: true, email, password };
}

type SignUpClient = {
  auth: {
    signUp(args: {
      email: string;
      password: string;
      options: { emailRedirectTo: string };
    }): Promise<{ data: { session: unknown | null; user: unknown | null }; error: { message: string } | null }>;
  };
};

export type SignupOutcome = { kind: "SIGNED_IN" } | { kind: "CONFIRM_EMAIL" } | { kind: "ERROR"; message: string };

/**
 * Registers a normal user with Supabase Auth. No `options.data` is ever sent, so no
 * role (or any other attribute) is written into user_metadata by FARJI. FARJI's own
 * User row is created separately, always as CANDIDATE.
 */
export async function performSignup(
  client: SignUpClient,
  input: { email: string; password: string },
  emailRedirectTo: string,
): Promise<SignupOutcome> {
  const { data, error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: { emailRedirectTo },
  });
  if (error) return { kind: "ERROR", message: "We could not create that account. Check your details and try again." };
  return data.session ? { kind: "SIGNED_IN" } : { kind: "CONFIRM_EMAIL" };
}
