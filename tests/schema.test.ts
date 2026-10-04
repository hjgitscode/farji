import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1], body: m[2] }));

describe("prisma schema", () => {
  it("defines the expected 21 models", () => {
    expect(models.map((m) => m.name).sort()).toEqual(
      [
        "User", "Profile", "Organisation", "OrganisationMember", "IssuerKey", "Claim", "ClaimVersion",
        "VerificationRequest", "ReviewDecision", "Credential", "Attestation", "CohortBatch", "CohortLeaf",
        "Anchor", "ProofPulseTree", "ProofPulseLeaf", "ProofPulseNode", "ProofPulseUpdate", "Revocation",
        "BlockchainTransaction", "AuditEvent",
      ].sort(),
    );
  });

  it("stores no verification state, verified flag or score on any model", () => {
    const forbidden = /(verified|verificationstate|verification_state|trust|reputation|score)/i;
    for (const { name, body } of models) {
      const fieldNames = body
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@"))
        .map((l) => l.split(/\s+/)[0]);
      for (const field of fieldNames) {
        expect(field, `${name}.${field} looks like stored verification state`).not.toMatch(forbidden);
      }
    }
  });

  it("has no IssuerKeyWindow model and no cascading deletes", () => {
    expect(schema).not.toMatch(/model\s+IssuerKeyWindow/);
    expect(schema).not.toMatch(/onDelete:\s*(Cascade|SetNull|SetDefault)/);
  });

  it("does not model REVOKED as a ProofPulse leaf status", () => {
    const m = schema.match(/enum PulseLeafStatus\s*\{([\s\S]*?)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/REVOKED/);
  });
});
