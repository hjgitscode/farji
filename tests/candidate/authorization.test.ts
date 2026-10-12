import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/authorize";
import {
  createClaim,
  getCandidateClaim,
  listCandidateClaims,
  listRequestableOrganisations,
  submitVerificationRequest,
  updateClaim,
  withdrawVerificationRequest,
  type ClaimsDb,
} from "@/server/candidate/claims";

const UUID = "11111111-1111-4111-8111-111111111111";

// Any database access at all makes the test fail: the role check must run first.
const untouchableDb = new Proxy(
  {},
  {
    get() {
      throw new Error("database was accessed before authorization");
    },
  },
) as unknown as ClaimsDb;

const actorWith = (role: Actor["role"], userId = UUID): Actor => ({
  userId,
  authUserId: UUID,
  role,
  organisationId: null,
  organisationStatus: null,
  memberId: null,
});

const calls: [string, (a: Actor) => Promise<unknown>][] = [
  ["createClaim", (a) => createClaim(untouchableDb, a, {})],
  ["updateClaim", (a) => updateClaim(untouchableDb, a, UUID, {})],
  ["listCandidateClaims", (a) => listCandidateClaims(untouchableDb, a)],
  ["getCandidateClaim", (a) => getCandidateClaim(untouchableDb, a, UUID)],
  ["listRequestableOrganisations", (a) => listRequestableOrganisations(untouchableDb, a)],
  ["submitVerificationRequest", (a) => submitVerificationRequest(untouchableDb, a, { claimId: UUID, claimVersionId: UUID, organisationId: UUID })],
  ["withdrawVerificationRequest", (a) => withdrawVerificationRequest(untouchableDb, a, UUID)],
];

describe("1. only a CANDIDATE actor can use the candidate services", () => {
  for (const [name, call] of calls) {
    it(`${name} rejects ISSUER and ADMIN before touching the database`, async () => {
      for (const role of ["ISSUER", "ADMIN"] as const) {
        await expect(call(actorWith(role))).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });

    it(`${name} rejects a missing or malformed actor`, async () => {
      await expect(call(undefined as unknown as Actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(call(actorWith("CANDIDATE", "not-a-uuid"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  }
});

describe("structural guarantees of the candidate workflow", () => {
  const root = path.join(__dirname, "..", "..");
  const serviceFiles = readdirSync(path.join(root, "server", "candidate")).map((f) => path.join(root, "server", "candidate", f));
  const actionsFile = path.join(root, "app", "candidate", "actions.ts");
  const source = (f: string) =>
    readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");

  it("12. candidate code never creates or changes a Credential, decision, attestation, key, anchor or revocation", () => {
    for (const file of [...serviceFiles, actionsFile]) {
      expect(source(file), path.relative(root, file)).not.toMatch(
        /\.(credential|reviewDecision|attestation|issuerKey|anchor|revocation|cohortBatch|cohortLeaf|proofPulse\w*|blockchainTransaction)\.(create|update|updateMany|upsert|delete|deleteMany)\b/,
      );
    }
  });

  it("13. no verification state, verified flag or score is introduced", () => {
    for (const file of [...serviceFiles, actionsFile, path.join(root, "lib", "core", "claims.ts")]) {
      expect(source(file), path.relative(root, file)).not.toMatch(/isVerified|verificationState|verification_state|trustScore|reputation|\bverified\s*[:=]/i);
    }
  });

  it("every server action authenticates with requireCandidate", () => {
    const code = source(actionsFile);
    const exported = (code.match(/export async function \w+/g) ?? []).length;
    const guarded = (code.match(/await requireCandidate\(/g) ?? []).length;
    expect(exported).toBeGreaterThan(0);
    expect(guarded).toBe(exported);
  });

  it("2. actions never read a user id, role or member/issuer reference from the form", () => {
    const code = source(actionsFile);
    expect(code).not.toMatch(/formData\.get\(\s*["'](userId|candidateId|role|memberId|issuerKeyId|reviewerMemberId|status)["']/);
    expect(code).not.toMatch(/\.get\(\s*["']candidate/);
    // The candidate identity passed to services is the guard's actor, never form input.
    expect(code).toMatch(/const actor = await requireCandidate/);
  });

  it("services derive the owner from actor.userId only", () => {
    const code = source(path.join(root, "server", "candidate", "claims.ts"));
    expect(code).not.toMatch(/candidateId:\s*input\./);
    expect(code).not.toMatch(/candidateId:\s*raw/);
  });
});
