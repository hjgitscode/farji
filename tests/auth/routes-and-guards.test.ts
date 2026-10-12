import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ActorLoad } from "@/lib/auth/authorize";
import { createGuards, denialPath } from "@/lib/auth/guard-core";
import { isProtectedPath, requiredRoleForPath } from "@/lib/auth/paths";

class Redirected extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}
const redirect = (to: string): never => {
  throw new Redirected(to);
};

const ok = (
  role: "CANDIDATE" | "ISSUER" | "ADMIN",
  organisationId: string | null = null,
  organisationStatus: "PENDING_ONBOARDING" | "ACTIVE" | "SUSPENDED" = "ACTIVE",
): ActorLoad => ({
  status: "OK",
  actor: {
    userId: "u",
    authUserId: "a",
    role,
    organisationId,
    organisationStatus: role === "ISSUER" && organisationId ? organisationStatus : null,
    memberId: organisationId ? "m" : null,
  },
});

async function redirectOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
}

describe("guards", () => {
  it("1. send anonymous visitors to login with a safe return path", async () => {
    const g = createGuards(async () => ({ status: "ANONYMOUS" }), redirect);
    expect(await redirectOf(() => g.requireCandidate("/candidate"))).toBe("/login?next=%2Fcandidate");
    expect(await redirectOf(() => g.requireIssuer("/issuer"))).toBe("/login?next=%2Fissuer");
    expect(await redirectOf(() => g.requireAdmin("/admin"))).toBe("/login?next=%2Fadmin");
    expect(await redirectOf(() => g.requireAdmin("https://evil.example"))).toBe("/login");
  });

  it("5/6. a candidate is turned away from issuer and admin guards", async () => {
    const g = createGuards(async () => ok("CANDIDATE"), redirect);
    expect(await redirectOf(() => g.requireIssuer("/issuer"))).toBe("/access-denied");
    expect(await redirectOf(() => g.requireAdmin("/admin"))).toBe("/access-denied");
    expect(await redirectOf(() => g.requireCandidate("/candidate"))).toBeNull();
  });

  it("7. an issuer without an organisation gets the organisation notice", async () => {
    const g = createGuards(async () => ok("ISSUER", null), redirect);
    expect(await redirectOf(() => g.requireIssuer("/issuer"))).toBe("/access-denied?reason=organisation");
  });

  it("an issuer of a suspended organisation gets the fixed inactive-organisation notice", async () => {
    const g = createGuards(async () => ok("ISSUER", "org-1", "SUSPENDED"), redirect);
    expect(await redirectOf(() => g.requireIssuer("/issuer"))).toBe("/access-denied?reason=organisation_inactive");
  });

  it("8/9. an issuer with an organisation and an admin pass their guards", async () => {
    const issuer = createGuards(async () => ok("ISSUER", "org-1"), redirect);
    expect((await issuer.requireIssuer("/issuer")).organisationId).toBe("org-1");
    const admin = createGuards(async () => ok("ADMIN"), redirect);
    expect((await admin.requireAdmin("/admin")).role).toBe("ADMIN");
  });

  it("requireAuthenticatedUser accepts any active role but not anonymous or disabled", async () => {
    expect(await redirectOf(() => createGuards(async () => ok("ADMIN"), redirect).requireAuthenticatedUser())).toBeNull();
    expect(await redirectOf(() => createGuards(async () => ({ status: "ANONYMOUS" }), redirect).requireAuthenticatedUser())).toBe("/login");
    expect(await redirectOf(() => createGuards(async () => ({ status: "DISABLED" }), redirect).requireAuthenticatedUser())).toBe(
      "/access-denied?reason=disabled",
    );
  });

  it("denial redirects never embed attacker-controlled text", () => {
    expect(denialPath("FORBIDDEN", "https://evil.example")).toBe("/access-denied");
    expect(denialPath("UNAUTHENTICATED", "//evil.example")).toBe("/login");
  });
});

describe("10. public routes stay public; private areas are recognised", () => {
  it("does not treat public or auth pages as protected", () => {
    for (const p of ["/", "/verify", "/verify/abc", "/login", "/signup", "/access-denied", "/auth/callback", "/api/health", "/p/some-handle"]) {
      expect(isProtectedPath(p)).toBe(false);
      expect(requiredRoleForPath(p)).toBeNull();
    }
  });

  it("protects the three private areas and everything nested under them", () => {
    for (const p of ["/candidate", "/candidate/profile", "/issuer", "/issuer/requests/1", "/admin", "/admin/organisations"]) {
      expect(isProtectedPath(p)).toBe(true);
    }
    expect(requiredRoleForPath("/issuer/x")).toBe("ISSUER");
    expect(requiredRoleForPath("/admin")).toBe("ADMIN");
    expect(isProtectedPath("/administrator")).toBe(false);
  });

  it("the proxy matcher excludes public pages", () => {
    const source = readFileSync(path.join(__dirname, "..", "..", "proxy.ts"), "utf8");
    const matcher = source.match(/matcher:\s*\[([^\]]*)\]/)?.[1] ?? "";
    expect(matcher).toContain("/candidate/:path*");
    expect(matcher).toContain("/issuer/:path*");
    expect(matcher).toContain("/admin/:path*");
    expect(matcher).not.toMatch(/["']\/["']|\/verify/);
  });
});

describe("structural guarantee: no private page or layout is unguarded", () => {
  const root = path.join(__dirname, "..", "..", "app");
  const expectations: Record<string, string> = { candidate: "requireCandidate", issuer: "requireIssuer", admin: "requireAdmin" };

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  }

  for (const [area, guard] of Object.entries(expectations)) {
    it(`every page/layout/route under app/${area} calls ${guard}`, () => {
      const files = walk(path.join(root, area)).filter((f) => /(page|layout|route)\.tsx?$/.test(f));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect(readFileSync(file, "utf8"), `${path.relative(root, file)} must call ${guard}()`).toMatch(new RegExp(`await ${guard}\\(`));
      }
    });
  }

  it("no auth code reads user_metadata or app_metadata for decisions", () => {
    const authDir = path.join(__dirname, "..", "..", "lib", "auth");
    for (const file of walk(authDir)) {
      const code = readFileSync(file, "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
      expect(code.join("\n"), path.relative(authDir, file)).not.toMatch(/user_metadata|app_metadata/);
    }
  });

  it("no source file reads a service-role / secret key from the environment", () => {
    const dirs = ["app", "lib", "components", "server"].map((d) => path.join(__dirname, "..", "..", d));
    for (const file of dirs.flatMap((d) => walk(d)).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("generated"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/process\.env\.[A-Z0-9_]*(SERVICE_ROLE|SECRET)/);
    }
  });
});
