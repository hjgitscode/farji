import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/authorize";
import {
  approveVerificationRequest,
  getIssuerRequest,
  listIssuerRequests,
  rejectVerificationRequest,
  type ReviewDb,
} from "@/server/issuer/review";

const UUID = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";

// Any database access at all makes the test fail: the role/membership check must run first.
const untouchableDb = new Proxy(
  {},
  {
    get() {
      throw new Error("database was accessed before authorization");
    },
  },
) as unknown as ReviewDb;

const issuer = (over: Partial<Actor> = {}): Actor => ({
  userId: UUID,
  authUserId: UUID,
  role: "ISSUER",
  organisationId: ORG,
  organisationStatus: "ACTIVE",
  memberId: MEMBER,
  ...over,
});

const calls: [string, (a: Actor) => Promise<unknown>][] = [
  ["listIssuerRequests", (a) => listIssuerRequests(untouchableDb, a)],
  ["getIssuerRequest", (a) => getIssuerRequest(untouchableDb, a, UUID)],
  ["approveVerificationRequest", (a) => approveVerificationRequest(untouchableDb, a, UUID, {})],
  ["rejectVerificationRequest", (a) => rejectVerificationRequest(untouchableDb, a, UUID, { rejectionReason: "OTHER", notes: "x" })],
];

describe("1-3. only an ACTIVE member of an ACTIVE organisation can use the issuer services", () => {
  for (const [name, call] of calls) {
    it(`${name} rejects CANDIDATE and ADMIN before touching the database`, async () => {
      for (const role of ["CANDIDATE", "ADMIN"] as const) {
        await expect(call(issuer({ role }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });

    it(`${name} rejects an issuer without an organisation or member`, async () => {
      await expect(call(issuer({ organisationId: null }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(call(issuer({ memberId: null }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(call(issuer({ organisationId: "not-a-uuid" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it(`${name} rejects an issuer of a suspended or not-yet-onboarded organisation`, async () => {
      for (const organisationStatus of ["SUSPENDED", "PENDING_ONBOARDING", null] as const) {
        await expect(call(issuer({ organisationStatus }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });

    it(`${name} rejects a missing or malformed actor`, async () => {
      await expect(call(undefined as unknown as Actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(call(issuer({ userId: "nope" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  }
});

describe("structural guarantees of the issuer workflow", () => {
  const root = path.join(__dirname, "..", "..");
  const serviceFiles = readdirSync(path.join(root, "server", "issuer")).map((f) => path.join(root, "server", "issuer", f));
  const actionsFile = path.join(root, "app", "issuer", "actions.ts");
  const source = (f: string) =>
    readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");

  it("18. issuer review code never creates an Attestation, Anchor, transaction, Merkle leaf, key or revocation", () => {
    for (const file of [...serviceFiles, actionsFile]) {
      expect(source(file), path.relative(root, file)).not.toMatch(
        /\.(attestation|anchor|revocation|blockchainTransaction|issuerKey|cohortBatch|cohortLeaf|proofPulse\w*)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/,
      );
      // No cryptography or chain access in Phase 5.
      expect(source(file), path.relative(root, file)).not.toMatch(/keccak|signTypedData|eip712|from ["']viem|from ["']ethers|merkle/i);
    }
  });

  it("the only Credential write is a creation in AWAITING_SIGNATURE; nothing updates or deletes one", () => {
    for (const file of [...serviceFiles, actionsFile]) {
      expect(source(file), path.relative(root, file)).not.toMatch(/\.credential\.(update|updateMany|upsert|delete|deleteMany)\b/);
    }
    const review = source(path.join(root, "server", "issuer", "review.ts"));
    expect(review.match(/\.credential\.create\(/g) ?? []).toHaveLength(1);
    expect(review).toMatch(/pipelineStatus: "AWAITING_SIGNATURE"/);
  });

  it("nothing deletes a request, decision, claim or version", () => {
    for (const file of [...serviceFiles, actionsFile]) {
      expect(source(file), path.relative(root, file)).not.toMatch(/\.(verificationRequest|reviewDecision|claim|claimVersion)\.(delete|deleteMany)\b/);
    }
  });

  it("19. no verification state, verified flag or score is introduced", () => {
    for (const file of [...serviceFiles, actionsFile, path.join(root, "lib", "core", "review.ts")]) {
      expect(source(file), path.relative(root, file)).not.toMatch(/isVerified|verificationState|verification_state|trustScore|reputation|\bverified\s*[:=]/i);
    }
  });

  it("20. decisions are gated by a conditional open -> terminal update (row-lock serialisation)", () => {
    const review = source(path.join(root, "server", "issuer", "review.ts"));
    expect(review).toMatch(/verificationRequest\.updateMany\(\{\s*where: \{ id: requestId, organisationId: scope\.organisationId, status: \{ in: \[\.\.\.OPEN_STATUSES\] \} \}/);
    expect(review).toMatch(/count !== 1/);
  });

  it("every server action authenticates with requireIssuer", () => {
    const code = source(actionsFile);
    const exported = (code.match(/export async function \w+/g) ?? []).length;
    const guarded = (code.match(/await requireIssuer\(/g) ?? []).length;
    expect(exported).toBeGreaterThan(0);
    expect(guarded).toBe(exported);
  });

  it("actions never read an organisation, member, key or candidate value from the form", () => {
    const code = source(actionsFile);
    expect(code).not.toMatch(/formData\.get\(\s*["'](organisationId|orgId|memberId|reviewerMemberId|userId|candidateId|role|status|issuerKeyId|decision)["']/);
    expect(code).toMatch(/const actor = await requireIssuer/);
  });

  it("every issuer page calls requireIssuer", () => {
    const pages = [
      path.join(root, "app", "issuer", "page.tsx"),
      path.join(root, "app", "issuer", "requests", "page.tsx"),
      path.join(root, "app", "issuer", "requests", "[requestId]", "page.tsx"),
    ];
    for (const p of pages) expect(source(p), path.relative(root, p)).toMatch(/await requireIssuer\(/);
  });

  it("scopes every query by the actor's organisation, never by input", () => {
    const review = source(path.join(root, "server", "issuer", "review.ts"));
    expect(review).not.toMatch(/organisationId:\s*input\./);
    expect(review).not.toMatch(/organisationId:\s*raw/);
    expect(review).not.toMatch(/reviewerMemberId:\s*(input|raw)/);
  });
});
