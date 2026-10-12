import { describe, expect, it } from "vitest";
import { authorize, loadActor } from "@/lib/auth/authorize";
import { getVerifiedAuthUserId } from "@/lib/auth/identity";
import { makeFakeDb } from "./fakes";

const AUTH_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

const candidate = { id: "u-c", authUserId: AUTH_ID, role: "CANDIDATE", status: "ACTIVE" } as const;
const issuer = { id: "u-i", authUserId: AUTH_ID, role: "ISSUER", status: "ACTIVE" } as const;
const admin = { id: "u-a", authUserId: AUTH_ID, role: "ADMIN", status: "ACTIVE" } as const;

async function decide(required: "CANDIDATE" | "ISSUER" | "ADMIN", seed: Parameters<typeof makeFakeDb>[0], authId: string | null = AUTH_ID) {
  const { db } = makeFakeDb(seed);
  return authorize(await loadActor(authId, db), required);
}

describe("unauthenticated visitors", () => {
  it("1. are denied every private area", async () => {
    for (const role of ["CANDIDATE", "ISSUER", "ADMIN"] as const) {
      expect(await decide(role, {}, null)).toEqual({ ok: false, reason: "UNAUTHENTICATED" });
    }
  });
});

describe("role boundaries", () => {
  it("5/6. a CANDIDATE cannot enter the issuer or admin areas", async () => {
    expect(await decide("ISSUER", { users: [candidate] })).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await decide("ADMIN", { users: [candidate] })).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("a CANDIDATE can enter the candidate area", async () => {
    expect((await decide("CANDIDATE", { users: [candidate] })).ok).toBe(true);
  });

  it("an ISSUER cannot enter the admin or candidate areas", async () => {
    const seed = { users: [issuer], members: [{ id: "m1", userId: "u-i", organisationId: ORG_ID, status: "ACTIVE" as const }] };
    expect(await decide("ADMIN", seed)).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await decide("CANDIDATE", seed)).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("an ADMIN is not automatically a CANDIDATE or ISSUER", async () => {
    expect(await decide("CANDIDATE", { users: [admin] })).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await decide("ISSUER", { users: [admin] })).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("9. an ADMIN passes admin authorization without any OrganisationMember", async () => {
    const result = await decide("ADMIN", { users: [admin] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.actor.organisationId).toBeNull();
  });

  it("suspended or deactivated accounts are denied everywhere", async () => {
    for (const status of ["SUSPENDED", "DEACTIVATED"] as const) {
      expect(await decide("CANDIDATE", { users: [{ ...candidate, status }] })).toEqual({ ok: false, reason: "ACCOUNT_DISABLED" });
    }
  });
});

describe("issuer organisation membership", () => {
  it("7. an ISSUER without an OrganisationMember is rejected", async () => {
    expect(await decide("ISSUER", { users: [issuer] })).toEqual({ ok: false, reason: "NO_ORGANISATION" });
  });

  it("7. INVITED or REMOVED memberships do not count", async () => {
    for (const status of ["INVITED", "REMOVED"] as const) {
      const seed = { users: [issuer], members: [{ id: "m1", userId: "u-i", organisationId: ORG_ID, status }] };
      expect(await decide("ISSUER", seed)).toEqual({ ok: false, reason: "NO_ORGANISATION" });
    }
  });

  it("7. another user's membership does not count", async () => {
    const seed = { users: [issuer], members: [{ id: "m1", userId: "someone-else", organisationId: ORG_ID, status: "ACTIVE" as const }] };
    expect(await decide("ISSUER", seed)).toEqual({ ok: false, reason: "NO_ORGANISATION" });
  });

  it("ACTIVE membership + SUSPENDED or PENDING_ONBOARDING organisation is denied", async () => {
    for (const organisationStatus of ["SUSPENDED", "PENDING_ONBOARDING"] as const) {
      const seed = {
        users: [issuer],
        members: [{ id: "m1", userId: "u-i", organisationId: ORG_ID, status: "ACTIVE" as const, organisationStatus }],
      };
      expect(await decide("ISSUER", seed)).toEqual({ ok: false, reason: "ORGANISATION_INACTIVE" });
    }
  });

  it("ACTIVE membership + ACTIVE organisation is allowed", async () => {
    const seed = {
      users: [issuer],
      members: [{ id: "m1", userId: "u-i", organisationId: ORG_ID, status: "ACTIVE" as const, organisationStatus: "ACTIVE" as const }],
    };
    const result = await decide("ISSUER", seed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.actor.organisationStatus).toBe("ACTIVE");
  });

  it("8. an ISSUER with an ACTIVE membership passes, and the organisation comes from the database", async () => {
    const seed = { users: [issuer], members: [{ id: "m1", userId: "u-i", organisationId: ORG_ID, status: "ACTIVE" as const }] };
    const result = await decide("ISSUER", seed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.organisationId).toBe(ORG_ID);
      expect(result.actor.memberId).toBe("m1");
    }
  });
});

describe("11. role decisions come from the FARJI database, not Supabase metadata", () => {
  const supabaseUserClaimingAdmin = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: AUTH_ID,
            user_metadata: { role: "ADMIN", roles: ["ADMIN"] },
            app_metadata: { role: "ADMIN" },
          },
        },
        error: null,
      }),
    },
  };

  it("only the verified user id is taken from Supabase", async () => {
    expect(await getVerifiedAuthUserId(supabaseUserClaimingAdmin)).toBe(AUTH_ID);
  });

  it("a user whose Supabase metadata says ADMIN is still only what the database says", async () => {
    const { db } = makeFakeDb({ users: [candidate] });
    const authUserId = await getVerifiedAuthUserId(supabaseUserClaimingAdmin);
    const load = await loadActor(authUserId, db);
    expect(load.status === "OK" && load.actor.role).toBe("CANDIDATE");
    expect(authorize(load, "ADMIN")).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("a brand-new user with ADMIN metadata is created as CANDIDATE", async () => {
    const { db, users } = makeFakeDb();
    const load = await loadActor(await getVerifiedAuthUserId(supabaseUserClaimingAdmin), db);
    expect(users).toHaveLength(1);
    expect(users[0].role).toBe("CANDIDATE");
    expect(authorize(load, "ADMIN").ok).toBe(false);
  });

  it("invalid, errored or anonymous Supabase sessions yield no identity", async () => {
    const bad = (user: unknown, error: unknown = null) => ({ auth: { getUser: async () => ({ data: { user: user as never }, error }) } });
    expect(await getVerifiedAuthUserId(bad(null))).toBeNull();
    expect(await getVerifiedAuthUserId(bad({ id: AUTH_ID }, new Error("jwt expired")))).toBeNull();
    expect(await getVerifiedAuthUserId(bad({ id: "not-a-uuid" }))).toBeNull();
    expect(await getVerifiedAuthUserId(bad({ id: AUTH_ID, is_anonymous: true }))).toBeNull();
  });
});
