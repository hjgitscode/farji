import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/authorize";
import { acceptCredentialSignature, prepareCredentialSigning } from "@/server/issuance/signing";
import { acceptStatusChange, prepareEndRelationship } from "@/server/issuance/status-change";
import type { IssuanceDb } from "@/server/issuance/common";
import { getCohortProof, sealCohortBatch } from "@/server/merkle/cohort";
import { enqueuePendingForOrganisation } from "@/server/merkle/enqueue";
import { getHistoricalPulseProof, getPulseProof } from "@/server/merkle/pulse";
import { TEST_CONFIG } from "../fixtures/test-wallets";

const UUID = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";

// Any database access at all fails the test: the actor check must run first.
const untouchableDb = new Proxy(
  {},
  {
    get() {
      throw new Error("database was accessed before authorization");
    },
  },
) as unknown as IssuanceDb;

const issuer = (over: Partial<Actor> = {}): Actor => ({
  userId: UUID,
  authUserId: UUID,
  role: "ISSUER",
  organisationId: ORG,
  organisationStatus: "ACTIVE",
  memberId: MEMBER,
  ...over,
});

const input = { signature: "0x" + "11".repeat(65), issuedAt: "1760000000", nonce: "0x" + "ab".repeat(32), effectiveAt: "1740000000" };
const opts = { config: TEST_CONFIG };

const calls: [string, (a: Actor) => Promise<unknown>][] = [
  ["prepareCredentialSigning", (a) => prepareCredentialSigning(untouchableDb, a, UUID, opts)],
  ["acceptCredentialSignature", (a) => acceptCredentialSignature(untouchableDb, a, UUID, input, opts)],
  ["prepareEndRelationship", (a) => prepareEndRelationship(untouchableDb, a, UUID, { effectiveAt: new Date(0) }, opts)],
  ["acceptStatusChange", (a) => acceptStatusChange(untouchableDb, a, UUID, input, opts)],
  ["sealCohortBatch", (a) => sealCohortBatch(untouchableDb, a)],
  ["getCohortProof", (a) => getCohortProof(untouchableDb, a, UUID)],
  ["getPulseProof", (a) => getPulseProof(untouchableDb, a, UUID)],
  ["getHistoricalPulseProof", (a) => getHistoricalPulseProof(untouchableDb, a, UUID, 1)],
  ["enqueuePendingForOrganisation", (a) => enqueuePendingForOrganisation(untouchableDb, a)],
];

describe("every issuance and Merkle service requires an ACTIVE member of an ACTIVE organisation", () => {
  for (const [name, call] of calls) {
    it(`${name} rejects non-issuers before touching the database`, async () => {
      for (const role of ["CANDIDATE", "ADMIN"] as const) {
        await expect(call(issuer({ role }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });

    it(`${name} rejects an issuer without a member or organisation, or of an inactive organisation`, async () => {
      await expect(call(issuer({ organisationId: null }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(call(issuer({ memberId: null }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      for (const organisationStatus of ["SUSPENDED", "PENDING_ONBOARDING", null] as const) {
        await expect(call(issuer({ organisationStatus }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      await expect(call(undefined as unknown as Actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  }
});

describe("structural guarantees of Phases 6 and 7", () => {
  const root = path.join(__dirname, "..", "..");
  const dirs = ["server/issuance", "server/merkle"].map((d) => path.join(root, d));
  const serverFiles = dirs.flatMap((d) => readdirSync(d).map((f) => path.join(d, f)));
  const libFiles = ["lib/crypto", "lib/merkle"].flatMap((d) => readdirSync(path.join(root, d)).filter((f) => f.endsWith(".ts")).map((f) => path.join(root, d, f)));
  const source = (f: string) =>
    readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");
  const all = [...serverFiles, ...libFiles];

  it("nothing creates a Revocation, BlockchainTransaction, Anchor or IssuerKey (ENDED is not revocation)", () => {
    for (const f of serverFiles) {
      expect(source(f), path.relative(root, f)).not.toMatch(/\.(revocation|blockchainTransaction|anchor|issuerKey|user|organisation|claim|claimVersion|verificationRequest|reviewDecision)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/);
    }
  });

  it("nothing is ever deleted from the evidence and Merkle tables", () => {
    for (const f of serverFiles) {
      expect(source(f), path.relative(root, f)).not.toMatch(/\.\w+\.(delete|deleteMany)\(/);
      expect(source(f), path.relative(root, f)).not.toMatch(/DELETE\s+FROM|TRUNCATE/i);
    }
  });

  it("the only Credential writes are conditional updateMany transitions (no unconditional update)", () => {
    for (const f of serverFiles) {
      const code = source(f);
      expect(code, path.relative(root, f)).not.toMatch(/\.credential\.(update|upsert|create|createMany)\(/);
    }
    const signing = source(path.join(root, "server/issuance/signing.ts"));
    expect(signing).toMatch(/pipelineStatus: "AWAITING_SIGNATURE", issuedAt: null/);
    expect(signing).toMatch(/credentialSalt: null/);
  });

  it("no verification state, verified flag or score is introduced", () => {
    for (const f of all) {
      expect(source(f), path.relative(root, f)).not.toMatch(/isVerified|verificationState|verification_state|trustScore|reputation|\bverified\s*[:=]/i);
    }
  });

  it("ProofPulse writes lock the tree, advance the root conditionally and never rebuild or schedule", () => {
    const pulse = source(path.join(root, "server/merkle/pulse.ts"));
    expect(pulse).toMatch(/FOR NO KEY UPDATE/);
    expect(pulse).toMatch(/currentRootSeq: tree\.currentRootSeq/);
    expect(pulse).toMatch(/count !== 1/);
    // Writes use the path update only; the full-tree replay is used solely to read history.
    const raw = readFileSync(path.join(root, "server/merkle/pulse.ts"), "utf8");
    const marker = raw.indexOf("// ───────────────────────────── proofs");
    const writers = raw.slice(raw.indexOf("async function getOrCreateTree"), marker);
    expect(marker).toBeGreaterThan(0);
    expect(writers).toMatch(/commitPathUpdate/);
    expect(writers).not.toMatch(/replayPulseLog|SparsePulseTree/);
    expect(raw.slice(marker)).toMatch(/replayPulseLog/);
    for (const f of serverFiles) {
      expect(source(f), path.relative(root, f)).not.toMatch(/setInterval|setTimeout|node-cron|new Date\(\)\.getMonth|getMonth\(|Cron/);
    }
  });

  it("CohortProof sealing and queuing take the organisation lock; sealed trees are only ever read", () => {
    const cohort = source(path.join(root, "server/merkle/cohort.ts"));
    expect(cohort.match(/lockOrganisation\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(cohort).not.toMatch(/\.cohortBatch\.(delete|deleteMany)/);
    expect(cohort).toMatch(/status: "OPEN"/);
  });

  it("the pure engines have no I/O, clock or randomness", () => {
    for (const f of libFiles) {
      expect(source(f), path.relative(root, f)).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random|randomBytes|randomUUID|process\.env|from ["']node:|prisma|fetch\(/);
    }
  });

  it("Merkle and signing services take the Actor from the guard, never an organisation from input", () => {
    for (const f of serverFiles) {
      const code = source(f);
      expect(code, path.relative(root, f)).not.toMatch(/organisationId:\s*(input|raw)\b/);
      expect(code, path.relative(root, f)).not.toMatch(/organisationId:\s*rawInput/);
    }
  });
});
