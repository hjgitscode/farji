import { describe, expect, it } from "vitest";
import { cohortLeafHash, verifyCohortProof } from "@/lib/merkle/cohort";
import { verifyPulseProof } from "@/lib/merkle/pulse";
import { buildProofBundle, PROOF_BUNDLE_FORMAT } from "@/lib/verification/bundle";
import { deriveCredentialState } from "@/lib/verification/derive";
import { isVerifiedState, presentState } from "@/lib/verification/present";
import { publicGroupOf, summariseStates } from "@/lib/verification/summary";
import { VERIFICATION_STATES } from "@/lib/verification/types";
import { addMs, cohortBuilt, days, ISSUED_AT, patched, POLICY, pulseBuilt, tx } from "../fixtures/evidence";

const NOW = addMs(ISSUED_AT, days(10));

describe("state presentation uses the Phase 10 wording", () => {
  const base = { lifecycleType: "PERMANENT", credentialId: null, organisation: { id: "o", displayName: "Acme Ltd" }, evidenceTimestamp: new Date("2026-03-05T00:00:00Z"), freshnessDeadline: new Date("2026-04-19T00:00:00Z"), expiry: new Date("2027-03-31T00:00:00Z"), endedAt: new Date("2026-05-01T00:00:00Z"), revokedAt: new Date("2026-06-01T00:00:00Z"), reasons: [], checks: [], evidenceSummary: {} } as never;
  const p = (state: (typeof VERIFICATION_STATES)[number], audience: "owner" | "public" = "owner") => presentState({ ...(base as object), state } as never, audience);

  it("every one of the eleven states has a headline, a badge and an explanation", () => {
    for (const s of VERIFICATION_STATES) {
      const x = p(s);
      expect(x.headline.length).toBeGreaterThan(5);
      expect(x.badge.length).toBeGreaterThan(2);
      expect(x.explanation.length).toBeGreaterThan(10);
    }
  });

  it("matches the product wording", () => {
    expect(p("PERMANENT_VALID").headline).toBe("Verified historical credential");
    expect(p("CURRENTLY_ATTESTED").headline).toBe("Currently confirmed by Acme Ltd");
    expect(p("STALE_NO_RECENT_ATTESTATION").headline).toBe("Last confirmed on 5 Mar 2026 · needs refresh");
    expect(p("VERIFIED").headline).toBe("Verified until 31 Mar 2027");
    expect(p("EXPIRED").headline).toBe("Expired on 31 Mar 2027");
    expect(p("ENDED").headline).toBe("Relationship ended on 1 May 2026");
    expect(p("REVOKED").headline).toBe("Credential revoked");
    expect(p("MODIFIED").headline).toBe("A newer verified record replaces this version");
    expect(p("PENDING").headline).toBe("Verification in progress");
    expect(p("SELF_DECLARED").headline).toBe("Added by you · not yet verified");
    expect(p("INVALID_PROOF").headline).toBe("Verification evidence could not be validated");
  });

  it("public self-declared wording never reads as verified", () => {
    const s = p("SELF_DECLARED", "public");
    expect(s.headline).toMatch(/self-declared/i);
    expect(s.headline).not.toMatch(/verified by/i);
    expect(isVerifiedState("SELF_DECLARED")).toBe(false);
    expect(isVerifiedState("PENDING")).toBe(false);
  });

  it("normal wording avoids technical terms", () => {
    for (const s of VERIFICATION_STATES) {
      const x = p(s);
      expect(`${x.headline} ${x.badge} ${x.explanation}`).not.toMatch(/merkle|eip-?712|keccak|hash|smart contract|blockchain|salt|nonce|calldata/i);
    }
  });
});

describe("dashboard counts and public grouping come from derived states", () => {
  it("counts exactly what the engine derived", () => {
    const c = summariseStates(["PERMANENT_VALID", "VERIFIED", "CURRENTLY_ATTESTED", "PENDING", "STALE_NO_RECENT_ATTESTATION", "SELF_DECLARED", "SELF_DECLARED", "REVOKED", "ENDED"]);
    expect(c).toEqual({ total: 9, verified: 3, currentlyAttested: 1, pending: 1, needsRefresh: 1, selfDeclared: 2, other: 2 });
    expect(summariseStates([])).toMatchObject({ total: 0, verified: 0 });
  });

  it("self-declared and pending are never grouped with verified; revoked/invalid are set apart", () => {
    expect(publicGroupOf("SELF_DECLARED")).toBe("SELF_DECLARED");
    expect(publicGroupOf("PENDING")).toBe("SELF_DECLARED");
    for (const s of ["PERMANENT_VALID", "VERIFIED", "CURRENTLY_ATTESTED", "STALE_NO_RECENT_ATTESTATION", "ENDED", "EXPIRED"] as const) expect(publicGroupOf(s)).toBe("VERIFIED");
    for (const s of ["REVOKED", "INVALID_PROOF", "MODIFIED"] as const) expect(publicGroupOf(s)).toBe("ATTENTION");
  });
});

const secretsOf = (m: { credentialSalt: string; contentSalt: string; subjectSalt: string; candidateId: string; attestation: { nonce: string } }) => [m.credentialSalt, m.contentSalt, m.subjectSalt, m.candidateId, m.attestation.nonce];

describe("proof bundle", () => {
  it("cohort: public evidence only, consistent with the derived state, and independently checkable", async () => {
    const b = await cohortBuilt();
    const result = deriveCredentialState(b.ev, NOW, b.policy);
    const anchor = b.ev.anchors[0];
    const bundle = buildProofBundle({ evidence: b.ev, result, domain: b.policy.domain, now: NOW, anchorTx: { [anchor.id]: { transactionHash: "0x" + "ab".repeat(32), blockNumber: "12" } } })!;

    expect(bundle.format).toBe(PROOF_BUNDLE_FORMAT);
    expect(bundle.derivedState.state).toBe(result.state);
    expect(bundle.derivedState.state).toBe("PERMANENT_VALID");
    expect(bundle.credential.credentialId).toBe(b.material.credentialId);
    expect(bundle.organisation.name).toBe("Acme Ltd");
    expect(bundle.anchorEvidence).toMatchObject({ attestationType: "COHORT", epoch: 1, transactionHash: "0x" + "ab".repeat(32), blockNumber: "12", transactionStatus: "FINALIZED" });

    // No private field, by key or by value.
    const json = JSON.stringify(bundle);
    for (const secret of secretsOf(b.material)) expect(json).not.toContain(secret);
    expect(json).not.toMatch(/contentSalt|subjectSalt|credentialSalt|"nonce"|candidateId|notes|sourceOfTruth|pipelineStatus/);
    expect(json).not.toContain("Software Engineer"); // claim content is never exported

    // Independently re-check with the same public helpers.
    const m = bundle.merkleEvidence as unknown as { type: string; leaf: Record<string, string | number>; leafHash: string; siblings: string[]; batchRoot: string };
    expect(m.type).toBe("COHORT");
    const leafHash = cohortLeafHash({ ...(m.leaf as unknown as Parameters<typeof cohortLeafHash>[0]), validFrom: BigInt(m.leaf.validFrom), validUntil: BigInt(m.leaf.validUntil), issuedAt: BigInt(m.leaf.issuedAt) });
    expect(leafHash).toBe(m.leafHash);
    expect(verifyCohortProof(m.batchRoot, m.leafHash, { siblings: m.siblings })).toBe(true);
    expect(m.batchRoot).toBe(anchor.batchRoot);
    // The signer is recoverable from the public hash and signature alone.
    const { ethers } = await import("ethers");
    expect(ethers.recoverAddress(bundle.safeAttestationEvidence.typedDataHash, bundle.safeAttestationEvidence.signature).toLowerCase()).toBe(bundle.safeAttestationEvidence.signerWallet);
  });

  it("proof-pulse: includes the first and latest epoch proofs that verify against their anchored roots", async () => {
    const T1 = addMs(ISSUED_AT, days(2));
    const b = await pulseBuilt({ steps: [{ t: "insert" }, { t: "anchor", at: T1 }, { t: "filler" }, { t: "anchor", at: addMs(T1, days(20)) }] });
    const result = deriveCredentialState(b.ev, addMs(T1, days(25)), b.policy);
    expect(result.state).toBe("CURRENTLY_ATTESTED");
    const bundle = buildProofBundle({ evidence: b.ev, result, domain: b.policy.domain, now: NOW, anchorTx: {} })!;
    const m = bundle.merkleEvidence as { type: string; depth: number; leafIndex: number; firstEpochProof: { epoch: number; root: string; leafHash: string; siblings: string[] }; latestActiveEpochProof: { epoch: number; root: string; leafHash: string; siblings: string[] } };
    expect(m.type).toBe("PROOF_PULSE");
    for (const proof of [m.firstEpochProof, m.latestActiveEpochProof]) {
      expect(verifyPulseProof(proof.root, m.depth, m.leafIndex, proof.leafHash, proof.siblings)).toBe(true);
      expect(b.ev.anchors.find((a) => a.epoch === proof.epoch)!.batchRoot).toBe(proof.root);
    }
    expect(m.firstEpochProof.root).not.toBe(m.latestActiveEpochProof.root); // historical root still provable
    for (const secret of secretsOf(b.material)) expect(JSON.stringify(bundle)).not.toContain(secret);
  });

  it("carries the derived state of REVOKED/ENDED/EXPIRED/INVALID credentials faithfully", async () => {
    const b = await cohortBuilt({ lifecycle: "EXPIRING" });
    const expired = deriveCredentialState(b.ev, new Date("2028-01-01T00:00:00Z"), b.policy);
    expect(buildProofBundle({ evidence: b.ev, result: expired, domain: b.policy.domain, now: NOW, anchorTx: {} })!.derivedState.state).toBe("EXPIRED");
    const revokedEv = patched(b.ev, { revocation: { organisationId: b.org.id, revokerKeyOrganisationId: b.org.id, revokedAt: NOW, transaction: tx("REVOKE_CREDENTIAL") } });
    const revoked = deriveCredentialState(revokedEv, NOW, b.policy);
    const rb = buildProofBundle({ evidence: revokedEv, result: revoked, domain: b.policy.domain, now: NOW, anchorTx: {}, revocationTx: { transactionHash: "0x" + "cd".repeat(32), blockNumber: "9" } })!;
    expect(rb.derivedState.state).toBe("REVOKED");
    expect(rb.revocation).toMatchObject({ transactionHash: "0x" + "cd".repeat(32) });
    const bad = patched(b.ev, { signed: { ...b.ev.signed!, contentDigest: "0x" + "9a".repeat(32) } });
    const invalid = deriveCredentialState(bad, NOW, POLICY);
    const ib = buildProofBundle({ evidence: bad, result: invalid, domain: POLICY.domain, now: NOW, anchorTx: {} })!;
    expect(ib.derivedState.state).toBe("INVALID_PROOF");
    expect(ib.merkleEvidence).toBeNull(); // nothing is presented as proof for evidence that failed
  });

  it("an unsigned credential has nothing to export", async () => {
    const b = await cohortBuilt();
    const unsigned = patched(b.ev, { signed: null, workflowSigned: false });
    const result = deriveCredentialState(unsigned, NOW, POLICY);
    expect(buildProofBundle({ evidence: unsigned, result, domain: POLICY.domain, now: NOW, anchorTx: {} })).toBeNull();
  });
});
