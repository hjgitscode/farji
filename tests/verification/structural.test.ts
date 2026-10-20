import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VERIFICATION_STATES } from "@/lib/verification";
import { policyFactory } from "@/server/verification/service";

// Structural guarantees of the Phase 10 verification engine: it is pure, it stores nothing, it has no verified
// flag, and the data it loads stays free of private review material.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const files = (dir: string) => readdirSync(join(root, dir)).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")).map((f) => `${dir}/${f}`);
/** Source without comments, so prose in documentation comments cannot trip the checks. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the engine is pure (lib/verification)", () => {
  const engine = files("lib/verification");

  it("has no I/O, database, server, clock or randomness", () => {
    expect(engine.length).toBeGreaterThanOrEqual(8);
    for (const f of engine) {
      const src = code(f);
      expect(src, f).not.toMatch(/from\s+["'](node:|fs|path|crypto)/);
      expect(src, f).not.toMatch(/@\/lib\/database|@\/server|@prisma|next\//);
      expect(src, f).not.toMatch(/Date\.now\s*\(|new Date\(\s*\)|Math\.random|process\.env|performance\.now/);
      expect(src, f).not.toMatch(/\bfetch\s*\(|await\s/);
    }
  });

  it("never reads workflow status as proof, and hardcodes no business policy", () => {
    for (const f of files("lib/verification")) {
      const src = code(f);
      expect(src, f).not.toMatch(/pipelineStatus|VerificationRequestStatus|\.status\s*===\s*["']ANCHORED["']/);
      expect(src, f).not.toMatch(/\b45\b/); // default freshness window is policy
      expect(src, f).not.toMatch(/30\s*\*\s*24|30\s*\*\s*86/); // maxAnchorDelay is policy
    }
  });

  it("declares exactly the eleven authoritative states", () => {
    expect([...VERIFICATION_STATES].sort()).toEqual(
      ["CURRENTLY_ATTESTED", "ENDED", "EXPIRED", "INVALID_PROOF", "MODIFIED", "PENDING", "PERMANENT_VALID", "REVOKED", "SELF_DECLARED", "STALE_NO_RECENT_ATTESTATION", "VERIFIED"].sort(),
    );
  });
});

describe("nothing about verification is stored", () => {
  it("the schema has no verified flag, score or stored state column", () => {
    const schema = read("prisma/schema.prisma").replace(/\/\/.*$/gm, "");
    expect(schema).not.toMatch(/^\s+(isVerified|verified|isValid|trustScore|trust|score|verificationState|currentVerificationState|derivedState|verificationStatus)\??\s/im);
  });

  it("the verification service and loader only read", () => {
    for (const f of files("server/verification")) {
      const src = code(f);
      expect(src, f).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
      expect(src, f).not.toMatch(/\$executeRaw|\$queryRaw|\$transaction/);
    }
  });

  it("the loader never touches reviewer notes, references or request notes", () => {
    for (const f of files("server/verification")) {
      const src = code(f);
      expect(src, f).not.toMatch(/reviewDecision|sourceOfTruthReference|\bnotes\b|institutionalIdentifier|candidateNote|auditEvent/);
    }
  });

  it("candidate pages show the derived state and never the pipeline status as a verification", () => {
    for (const f of ["app/candidate/claims/page.tsx", "app/candidate/claims/[claimId]/page.tsx"]) {
      const src = code(f);
      expect(src, f).toContain("VerificationStatus");
      expect(src, f).not.toMatch(/pipelineStatus/);
    }
  });
});

describe("policy comes from configuration", () => {
  it("is unavailable (never a guessed domain) when the chain and registry are not configured", () => {
    const saved = { c: process.env.FARJI_CHAIN_ID, r: process.env.FARJI_REGISTRY_ADDRESS };
    delete process.env.FARJI_CHAIN_ID;
    delete process.env.FARJI_REGISTRY_ADDRESS;
    try {
      expect(policyFactory()).toBeNull();
    } finally {
      if (saved.c !== undefined) process.env.FARJI_CHAIN_ID = saved.c;
      if (saved.r !== undefined) process.env.FARJI_REGISTRY_ADDRESS = saved.r;
    }
  });

  it("carries D7's 30 days and the organisation's own freshness window", () => {
    const factory = policyFactory({ chainId: 31337n, verifyingContract: "0x" + "ab".repeat(20) })!;
    expect(factory(45).maxAnchorDelayMs).toBe(30 * 24 * 3600 * 1000);
    expect(factory(10).pulseFreshnessDays).toBe(10);
    expect(factory(90).pulseFreshnessDays).toBe(90);
  });
});
