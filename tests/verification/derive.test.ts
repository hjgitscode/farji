import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chainRootOf } from "@/lib/crypto/chain-root";
import { deriveClaimState, deriveCredentialState } from "@/lib/verification";
import type { CredentialEvidence, ReasonCode, VerificationPolicy, VerificationState } from "@/lib/verification";
import { freshWallet } from "../fixtures/test-wallets";
import {
  addMs,
  cohortBuilt,
  days,
  ISSUED_AT,
  mkAnchor,
  mkKey,
  mkOrg,
  POLICY,
  pulseBuilt,
  signMaterial,
  tx,
  withAnchor,
  withMaterial,
  patched,
  type Built,
} from "../fixtures/evidence";

// Table-driven tests of the pure verification-state engine (ROADMAP Phase 10). Evidence is REAL: signed by a
// test wallet and Merkle-anchored with the production helpers; each test breaks exactly one thing. Time is
// always an explicit `now`.

const NOW = addMs(ISSUED_AT, days(10));
const state = (b: { ev: CredentialEvidence; policy: VerificationPolicy }, now = NOW, policy = b.policy) => deriveCredentialState(b.ev, now, policy);
const codes = (r: { reasons: { code: ReasonCode }[] }) => r.reasons.map((x) => x.code);
const expectState = (r: { state: VerificationState }, s: VerificationState) => expect(r.state).toBe(s);

describe("A. SELF_DECLARED / PENDING (never INVALID_PROOF)", () => {
  const claim = { claimId: randomUUID(), proposedLifecycleType: "PERMANENT" as const, requestInProgress: false, requestedOrganisation: null, credential: null };

  it("a bare claim, or one whose request was rejected/withdrawn, is SELF_DECLARED", () => {
    const r = deriveClaimState(claim, NOW, POLICY);
    expectState(r, "SELF_DECLARED");
    expect(r.evidenceSummary.signed).toBe(false);
    expect(r.organisation).toBeNull();
  });

  it("an open or approved request is PENDING and names the organisation", () => {
    const org = { id: randomUUID(), displayName: "Acme Ltd" };
    const r = deriveClaimState({ ...claim, requestInProgress: true, requestedOrganisation: org }, NOW, POLICY);
    expectState(r, "PENDING");
    expect(r.organisation).toEqual(org);
  });

  it("approved but awaiting signature is PENDING", async () => {
    const b = await cohortBuilt();
    const ev = patched(b.ev, { signed: null, workflowSigned: false, cohort: null, anchors: [] });
    const r = deriveClaimState({ ...claim, credential: ev }, NOW, POLICY);
    expectState(r, "PENDING");
    expect(codes(r)).toContain("AWAITING_SIGNATURE");
  });

  it("signed but waiting for the qualifying final anchor is PENDING", async () => {
    const b = await cohortBuilt({ anchoredAt: null });
    const r = deriveClaimState({ ...claim, credential: b.ev }, NOW, POLICY);
    expectState(r, "PENDING");
    expect(codes(r)).toContain("AWAITING_ANCHOR");
  });

  it("a credential recorded as signed but with no attestation is INVALID_PROOF (missing evidence), not PENDING", async () => {
    const b = await cohortBuilt();
    const r = deriveCredentialState(patched(b.ev, { signed: null, workflowSigned: true }), NOW, POLICY);
    expectState(r, "INVALID_PROOF");
    expect(codes(r)).toContain("ATTESTATION_MISSING");
  });

  it("the workflow pipeline status is not an input: unsigned evidence never yields a positive state", async () => {
    const b = await cohortBuilt();
    for (const workflowSigned of [true, false]) {
      const r = deriveCredentialState(patched(b.ev, { signed: null, workflowSigned }), NOW, POLICY);
      expect(["PENDING", "INVALID_PROOF"]).toContain(r.state);
    }
  });
});

describe("PERMANENT", () => {
  it("valid evidence -> PERMANENT_VALID with a fully passing check list", async () => {
    const b = await cohortBuilt();
    const r = state(b);
    expectState(r, "PERMANENT_VALID");
    expect(r.evidenceTimestamp).toEqual(addMs(ISSUED_AT, days(2)));
    expect(r.evidenceSummary).toMatchObject({ signed: true, anchored: true, anchorEpoch: 1, attestationType: "COHORT", revoked: false, superseded: false });
    expect(r.checks.filter((c) => c.status === "FAIL")).toEqual([]);
    expect(codes(r)).toEqual(["VALID_PERMANENT"]);
  });

  it("time passing never changes a permanent credential", async () => {
    const b = await cohortBuilt();
    for (const years of [1, 10, 100]) expectState(state(b, addMs(ISSUED_AT, days(365 * years))), "PERMANENT_VALID");
  });

  it("a longer chain: the anchor at epoch 3 is valid when epochs 1-2 are present", async () => {
    expectState(state(await cohortBuilt({ epoch: 3 })), "PERMANENT_VALID");
  });

  it("no cohort leaf yet / sealed but never anchored -> PENDING", async () => {
    const b = await cohortBuilt({ anchoredAt: null });
    expectState(state(b), "PENDING");
    expectState(state({ ...b, ev: patched(b.ev, { cohort: null }) }), "PENDING");
  });

  it("an anchor whose transaction is CONFIRMED but not FINALIZED is PENDING (D17)", async () => {
    for (const status of ["PENDING", "CONFIRMED"] as const) {
      const r = state(await cohortBuilt({ anchorStatus: status }));
      expectState(r, "PENDING");
      expect(codes(r)).toContain("ANCHOR_NOT_FINAL");
    }
  });

  it("D7 window: exactly 30 days is valid, one second later is INVALID_PROOF", async () => {
    expectState(state(await cohortBuilt({ anchoredAt: addMs(ISSUED_AT, days(30)) })), "PERMANENT_VALID");
    const late = state(await cohortBuilt({ anchoredAt: addMs(ISSUED_AT, days(30) + 1000) }));
    expectState(late, "INVALID_PROOF");
    expect(codes(late)).toContain("ANCHOR_TOO_LATE");
  });

  it("an anchor older than the signature is INVALID_PROOF", async () => {
    const r = state(await cohortBuilt({ anchoredAt: addMs(ISSUED_AT, -1000) }));
    expectState(r, "INVALID_PROOF");
    expect(codes(r)).toContain("ANCHOR_BEFORE_ISSUANCE");
  });

  it("never anchored and the window has passed stays PENDING (not proven invalid), and says so", async () => {
    const b = await cohortBuilt({ anchoredAt: null });
    const r = state(b, addMs(ISSUED_AT, days(31)));
    expectState(r, "PENDING");
    expect(codes(r)).toContain("ANCHOR_WINDOW_ELAPSED");
    expect(codes(state(b, addMs(ISSUED_AT, days(5))))).not.toContain("ANCHOR_WINDOW_ELAPSED");
  });

  it("the window is policy, not hardcoded", async () => {
    const b = await cohortBuilt({ anchoredAt: addMs(ISSUED_AT, days(10)) });
    expectState(state(b, NOW, { ...POLICY, maxAnchorDelayMs: days(9) }), "INVALID_PROOF");
    expectState(state(b, NOW, { ...POLICY, maxAnchorDelayMs: days(10) }), "PERMANENT_VALID");
  });

  it("bad Merkle proof / foreign leaf -> INVALID_PROOF", async () => {
    const b = await cohortBuilt();
    const bad = patched(b.ev, { cohort: { ...b.ev.cohort!, proof: { siblings: [b.ev.cohort!.proof!.siblings[0].replace(/.$/, "0")] } } });
    const r = deriveCredentialState(bad, NOW, POLICY);
    expectState(r, "INVALID_PROOF");
    expect(codes(r)).toContain("MERKLE_PROOF_INVALID");
    expectState(deriveCredentialState(patched(b.ev, { cohort: { ...b.ev.cohort!, leafHash: "0x" + "ab".repeat(32) } }), NOW, POLICY), "INVALID_PROOF");
    expectState(deriveCredentialState(patched(b.ev, { cohort: { ...b.ev.cohort!, proof: null } }), NOW, POLICY), "INVALID_PROOF");
  });

  it("an anchor carrying a different root or leaf count -> INVALID_PROOF", async () => {
    const b = await cohortBuilt();
    const a = b.ev.anchors[0];
    const other = "0x" + "cd".repeat(32);
    const rebuilt = { batchRoot: other, chainRoot: chainRootOf(other, a.previousChainRoot, b.org.orgId, "COHORT", 1n) };
    const r = deriveCredentialState(withAnchor(b.ev, 0, rebuilt), NOW, POLICY);
    expectState(r, "INVALID_PROOF");
    expect(codes(r)).toContain("ANCHOR_ROOT_MISMATCH");
    expectState(deriveCredentialState(withAnchor(b.ev, 0, { leafCount: 99 }), NOW, POLICY), "INVALID_PROOF");
  });

  it("a chainRoot that does not match the formula, or a broken link -> INVALID_PROOF", async () => {
    const b = await cohortBuilt();
    const r = deriveCredentialState(withAnchor(b.ev, 0, { chainRoot: "0x" + "ee".repeat(32) }), NOW, POLICY);
    expectState(r, "INVALID_PROOF");
    expect(codes(r)).toContain("ANCHOR_CHAIN_BROKEN");

    const three = await cohortBuilt({ epoch: 3 });
    const bad = three.ev.anchors.map((a, i) => (i === 1 ? { ...a, chainRoot: chainRootOf(a.batchRoot, "0x" + "11".repeat(32), three.org.orgId, "COHORT", 2n), previousChainRoot: "0x" + "11".repeat(32) } : a));
    expectState(deriveCredentialState(patched(three.ev, { anchors: bad }), NOW, POLICY), "INVALID_PROOF");
  });

  it("earlier epochs not yet synchronised is incomplete evidence (PENDING), not tampering", async () => {
    const b = await cohortBuilt({ epoch: 3 });
    const r = deriveCredentialState(patched(b.ev, { anchors: b.ev.anchors.filter((a) => a.epoch !== 2) }), NOW, POLICY);
    expectState(r, "PENDING");
    expect(codes(r)).toContain("ANCHOR_CHAIN_INCOMPLETE");
  });

  describe("another Organisation's evidence is rejected", () => {
    it("an anchor of a different organisation", async () => {
      const b = await cohortBuilt();
      const r = deriveCredentialState(withAnchor(b.ev, 0, { organisationId: randomUUID() }), NOW, POLICY);
      expectState(r, "INVALID_PROOF");
      expect(codes(r)).toContain("ANCHOR_ORGANISATION_MISMATCH");
    });

    it("an anchor submitted by another organisation's wallet", async () => {
      const b = await cohortBuilt();
      expectState(deriveCredentialState(withAnchor(b.ev, 0, { anchorerKeyOrganisationId: randomUUID() }), NOW, POLICY), "INVALID_PROOF");
    });

    it("the same root anchored in ANOTHER organisation's chain does not verify this credential", async () => {
      const b = await cohortBuilt();
      const other = mkOrg();
      const a = b.ev.anchors[0];
      const foreign = mkAnchor({ org: other, type: "COHORT", epoch: 1, batchRoot: a.batchRoot, previousChainRoot: a.previousChainRoot, at: a.blockTimestamp, leafCount: a.leafCount });
      const r = deriveCredentialState(patched(b.ev, { anchors: [{ ...foreign, id: a.id }] }), NOW, POLICY);
      expectState(r, "INVALID_PROOF");
    });

    it("a signature by a wallet of another organisation", async () => {
      const b = await cohortBuilt();
      const att = b.material.attestation;
      const r = deriveCredentialState(withMaterial(b.ev, { attestation: { ...att, signerKey: { ...att.signerKey, organisationId: randomUUID() } } }), NOW, POLICY);
      expectState(r, "INVALID_PROOF");
      expect(codes(r)).toContain("SIGNER_ORGANISATION_MISMATCH");
    });

    it("a credential id derived under another organisation's orgId", async () => {
      const b = await cohortBuilt();
      expectState(deriveCredentialState(withMaterial(b.ev, { orgId: mkOrg().orgId }), NOW, POLICY), "INVALID_PROOF");
    });

    it("a revocation recorded for another organisation is ignored and flagged", async () => {
      const b = await cohortBuilt();
      const r = deriveCredentialState(patched(b.ev, { revocation: { organisationId: randomUUID(), revokerKeyOrganisationId: randomUUID(), revokedAt: NOW, transaction: tx("REVOKE_CREDENTIAL") } }), NOW, POLICY);
      expectState(r, "PERMANENT_VALID");
      expect(codes(r)).toContain("REVOCATION_IGNORED");
    });
  });

  describe("issuer-key rules", () => {
    it("compromise is judged at ANCHOR time: before -> valid, at or after -> INVALID_PROOF", async () => {
      const anchoredAt = addMs(ISSUED_AT, days(2));
      expectState(state(await cohortBuilt({ keyOver: { compromisedAt: addMs(anchoredAt, 1000) } })), "PERMANENT_VALID");
      for (const offset of [0, -1000, -days(1)]) {
        const r = state(await cohortBuilt({ keyOver: { compromisedAt: addMs(anchoredAt, offset) } }));
        expectState(r, "INVALID_PROOF");
        expect(codes(r)).toContain("SIGNER_COMPROMISED");
      }
    });

    it("compromise after signing but BEFORE the first anchor: not positive even though the key was valid when signing", async () => {
      const issuedAt = ISSUED_AT;
      const r = state(await cohortBuilt({ issuedAt, anchoredAt: addMs(issuedAt, days(20)), keyOver: { compromisedAt: addMs(issuedAt, days(5)) } }));
      expectState(r, "INVALID_PROOF");
    });

    it("never-anchored evidence from a key already compromised can no longer qualify", async () => {
      const r = state(await cohortBuilt({ anchoredAt: null, keyOver: { compromisedAt: addMs(ISSUED_AT, days(1)) } }));
      expectState(r, "INVALID_PROOF");
    });

    it("a key retired AFTER signing stays valid forever", async () => {
      const b = await cohortBuilt({ keyOver: { validUntil: addMs(ISSUED_AT, 3600_000) } });
      expectState(state(b, addMs(ISSUED_AT, days(900))), "PERMANENT_VALID");
    });

    it("a key not authorised at the signed issuance time is INVALID_PROOF", async () => {
      for (const keyOver of [{ validFrom: addMs(ISSUED_AT, 1000) }, { validUntil: addMs(ISSUED_AT, -1000) }, { validUntil: ISSUED_AT }]) {
        const r = state(await cohortBuilt({ keyOver }));
        expectState(r, "INVALID_PROOF");
        expect(codes(r)).toContain("SIGNER_NOT_AUTHORISED");
      }
    });

    it("a hand-made key whose authorisation is not FINALIZED has no authority (D46)", async () => {
      const r = state(await cohortBuilt({ keyOver: { authorisationFinalized: false } }));
      expectState(r, "INVALID_PROOF");
      expect(codes(r)).toContain("SIGNER_AUTHORISATION_NOT_FINAL");
    });
  });

  describe("cryptographic tampering -> INVALID_PROOF", () => {
    it("altered claim content", async () => {
      const b = await cohortBuilt();
      const r = deriveCredentialState(withMaterial(b.ev, { claimContent: { ...(b.material.claimContent as object), title: "CEO" } }), NOW, POLICY);
      expectState(r, "INVALID_PROOF");
      expect(codes(r)).toContain("SIGNED_MATERIAL_MISMATCH");
    });

    it("altered digest, subject commitment, salt, dates or credential id", async () => {
      const b = await cohortBuilt();
      const bad = "0x" + "9a".repeat(32);
      for (const patch of [{ contentDigest: bad }, { subjectCommitment: bad }, { contentSalt: bad }, { credentialSalt: bad }, { credentialId: bad }, { validFrom: new Date("2020-01-01T00:00:00Z") }]) {
        expectState(deriveCredentialState(withMaterial(b.ev, patch), NOW, POLICY), "INVALID_PROOF");
      }
    });

    it("a signature by a different wallet, a garbled signature, a replayed nonce", async () => {
      const b = await cohortBuilt();
      const att = b.material.attestation;
      const other = await signMaterial({ org: b.org, wallet: freshWallet(), key: att.signerKey, lifecycle: "PERMANENT" });
      expectState(deriveCredentialState(withMaterial(b.ev, { attestation: { ...att, signature: other.attestation.signature } }), NOW, POLICY), "INVALID_PROOF");
      expectState(deriveCredentialState(withMaterial(b.ev, { attestation: { ...att, signature: "0x" + "00".repeat(65) } }), NOW, POLICY), "INVALID_PROOF");
      expectState(deriveCredentialState(withMaterial(b.ev, { attestation: { ...att, nonce: "0x" + "77".repeat(32) } }), NOW, POLICY), "INVALID_PROOF");
    });

    it("signed under a different chain or registry", async () => {
      const b = await cohortBuilt();
      expectState(state(b, NOW, { ...POLICY, domain: { ...POLICY.domain, chainId: 1n } }), "INVALID_PROOF");
      expectState(state(b, NOW, { ...POLICY, domain: { ...POLICY.domain, verifyingContract: "0x" + "12".repeat(20) } }), "INVALID_PROOF");
    });

    it("an anchor on a different chain", async () => {
      const b = await cohortBuilt();
      const r = deriveCredentialState(withAnchor(b.ev, 0, { transaction: { ...tx("ANCHOR_COHORT"), chainId: 1 } }), NOW, POLICY);
      expectState(r, "INVALID_PROOF");
      expect(codes(r)).toContain("ANCHOR_CHAIN_MISMATCH");
    });
  });
});

describe("B. REVOKED overrides everything", () => {
  const revocation = (over = {}) => ({ organisationId: "", revokerKeyOrganisationId: "", revokedAt: addMs(ISSUED_AT, days(5)), transaction: tx("REVOKE_CREDENTIAL"), ...over });
  const revoked = (b: Built, ev: CredentialEvidence = b.ev) => patched(ev, { revocation: revocation({ organisationId: b.org.id, revokerKeyOrganisationId: b.org.id }) });

  it("PERMANENT, EXPIRING and CONTINUING all become REVOKED", async () => {
    for (const b of [await cohortBuilt(), await cohortBuilt({ lifecycle: "EXPIRING" }), await pulseBuilt()]) {
      const r = deriveCredentialState(revoked(b), NOW, POLICY);
      expectState(r, "REVOKED");
      expect(r.revokedAt).toEqual(addMs(ISSUED_AT, days(5)));
      expect(r.evidenceSummary.revoked).toBe(true);
    }
  });

  it("revocation beats INVALID_PROOF, MODIFIED, ENDED, EXPIRED and PENDING", async () => {
    const broken = await cohortBuilt();
    expectState(deriveCredentialState(revoked(broken, withMaterial(broken.ev, { contentDigest: "0x" + "ab".repeat(32) })), NOW, POLICY), "REVOKED");

    const superseded = await cohortBuilt();
    const successor = await signMaterial({ org: superseded.org, wallet: superseded.wallet, key: superseded.material.attestation.signerKey, lifecycle: "PERMANENT", issuedAt: addMs(ISSUED_AT, days(3)), supersedesCredentialId: superseded.material.credentialId });
    expectState(deriveCredentialState(revoked(superseded, patched(superseded.ev, { successor })), NOW, POLICY), "REVOKED");

    const ended = await pulseBuilt({ steps: [{ t: "insert" }, { t: "anchor", at: addMs(ISSUED_AT, days(1)) }, { t: "end", issuedAt: addMs(ISSUED_AT, days(3)), effectiveAt: addMs(ISSUED_AT, days(2)) }] });
    expectState(deriveCredentialState(revoked(ended), NOW, POLICY), "REVOKED");

    const expired = await cohortBuilt({ lifecycle: "EXPIRING" });
    expectState(deriveCredentialState(revoked(expired), new Date("2030-01-01T00:00:00Z"), POLICY), "REVOKED");

    expectState(deriveCredentialState(revoked(await cohortBuilt({ anchoredAt: null })), NOW, POLICY), "REVOKED");
  });

  it("only a FINALIZED revocation counts; a mined-but-not-final one is noted and not applied", async () => {
    const b = await cohortBuilt();
    const r = deriveCredentialState(patched(b.ev, { revocation: revocation({ organisationId: b.org.id, revokerKeyOrganisationId: b.org.id, transaction: tx("REVOKE_CREDENTIAL", "CONFIRMED") }) }), NOW, POLICY);
    expectState(r, "PERMANENT_VALID");
    expect(codes(r)).toContain("REVOCATION_NOT_FINAL");
  });
});

describe("D. MODIFIED (supersession)", () => {
  async function superseded(over: { lifecycle?: "PERMANENT" | "EXPIRING"; issuedAt?: Date; keyOver?: object; supersedes?: string; wallet?: ReturnType<typeof freshWallet> } = {}) {
    const b = await cohortBuilt({ lifecycle: over.lifecycle });
    const successor = await signMaterial({
      org: b.org,
      wallet: over.wallet ?? b.wallet,
      key: { ...(over.wallet ? mkKey(b.org, over.wallet) : b.material.attestation.signerKey), ...over.keyOver },
      lifecycle: over.lifecycle ?? "PERMANENT",
      candidateId: b.material.candidateId,
      issuedAt: over.issuedAt ?? addMs(ISSUED_AT, days(3)),
      supersedesCredentialId: over.supersedes ?? b.material.credentialId,
    });
    return { b, successor, ev: patched(b.ev, { successor }) };
  }

  it("a newer attested credential makes the older one MODIFIED, even though the newer one is not yet anchored", async () => {
    const { ev } = await superseded();
    const r = deriveCredentialState(ev, NOW, POLICY);
    expectState(r, "MODIFIED");
    expect(r.evidenceSummary.superseded).toBe(true);
    expect(codes(r)).toContain("SUPERSEDED");
  });

  it("MODIFIED beats PENDING (older not yet anchored), EXPIRED and a stale lifecycle", async () => {
    const pending = await cohortBuilt({ anchoredAt: null });
    const successor = await signMaterial({ org: pending.org, wallet: pending.wallet, key: pending.material.attestation.signerKey, lifecycle: "PERMANENT", issuedAt: addMs(ISSUED_AT, days(3)), supersedesCredentialId: pending.material.credentialId });
    expectState(deriveCredentialState(patched(pending.ev, { successor }), NOW, POLICY), "MODIFIED");
    const { ev } = await superseded({ lifecycle: "EXPIRING" });
    expectState(deriveCredentialState(ev, new Date("2030-01-01T00:00:00Z"), POLICY), "MODIFIED");
  });

  it("INVALID_PROOF of the OLDER credential beats MODIFIED", async () => {
    const { ev } = await superseded();
    expectState(deriveCredentialState(withMaterial(ev, { contentDigest: "0x" + "ab".repeat(32) }), NOW, POLICY), "INVALID_PROOF");
  });

  it("a successor that does not verify is ignored (it can never change the state)", async () => {
    const { b, successor } = await superseded();
    const att = successor.attestation;
    const forged = { ...successor, attestation: { ...att, signature: "0x" + "00".repeat(65) } };
    const r = deriveCredentialState(patched(b.ev, { successor: forged }), NOW, POLICY);
    expectState(r, "PERMANENT_VALID");
    expect(codes(r)).toContain("SUCCESSOR_IGNORED");
  });

  it("a successor must name THIS credential, belong to the same organisation and not predate it", async () => {
    const wrongTarget = await superseded({ supersedes: "0x" + "55".repeat(32) });
    expectState(deriveCredentialState(wrongTarget.ev, NOW, POLICY), "PERMANENT_VALID");
    const earlier = await superseded({ issuedAt: addMs(ISSUED_AT, -days(1)) });
    expectState(deriveCredentialState(earlier.ev, NOW, POLICY), "PERMANENT_VALID");
    const { b, successor } = await superseded();
    const foreign = { ...successor, organisationId: randomUUID() };
    expectState(deriveCredentialState(patched(b.ev, { successor: foreign }), NOW, POLICY), "PERMANENT_VALID");
  });

  it("a successor signed by a compromised wallet or an unauthorised wallet does not supersede", async () => {
    const compromised = await superseded({ keyOver: { compromisedAt: addMs(ISSUED_AT, days(8)) } });
    expectState(deriveCredentialState(compromised.ev, NOW, POLICY), "PERMANENT_VALID");
    const notFinal = await superseded({ keyOver: { authorisationFinalized: false } });
    expectState(deriveCredentialState(notFinal.ev, NOW, POLICY), "PERMANENT_VALID");
  });
});

describe("EXPIRING", () => {
  const validUntil = new Date("2027-03-31T00:00:00Z");

  it("before validUntil -> VERIFIED; exactly at validUntil -> EXPIRED; after -> EXPIRED", async () => {
    const b = await cohortBuilt({ lifecycle: "EXPIRING" });
    const before = state(b, addMs(validUntil, -1000));
    expectState(before, "VERIFIED");
    expect(before.expiry).toEqual(validUntil);
    expectState(state(b, validUntil), "EXPIRED");
    expectState(state(b, addMs(validUntil, 1000)), "EXPIRED");
    expectState(state(b, addMs(validUntil, days(900))), "EXPIRED");
  });

  it("expiry is not invalid evidence and not revocation", async () => {
    const r = state(await cohortBuilt({ lifecycle: "EXPIRING" }), addMs(validUntil, days(3)));
    expect(r.checks.filter((c) => c.status === "FAIL")).toEqual([]);
    expect(r.revokedAt).toBeNull();
    expect(codes(r)).not.toContain("REVOKED");
  });

  it("invalid proof still wins over EXPIRED, and the late-anchor rule applies", async () => {
    const late = await cohortBuilt({ lifecycle: "EXPIRING", anchoredAt: addMs(ISSUED_AT, days(40)) });
    expectState(state(late, addMs(validUntil, days(3))), "INVALID_PROOF");
    expectState(state(late, NOW), "INVALID_PROOF");
  });

  it("signed but NOT anchored is PENDING before, exactly at and after validUntil (evidence comes before expiry)", async () => {
    const b = await cohortBuilt({ lifecycle: "EXPIRING", anchoredAt: null });
    for (const now of [NOW, addMs(validUntil, -1000), validUntil, addMs(validUntil, 1000), addMs(validUntil, days(900))]) {
      const r = state(b, now);
      expectState(r, "PENDING");
      expect(r.state).not.toBe("EXPIRED");
    }
    expectState(state({ ...b, ev: patched(b.ev, { cohort: null }) }, validUntil), "PENDING");
    expectState(state(await cohortBuilt({ lifecycle: "EXPIRING", anchorStatus: "CONFIRMED" }), addMs(validUntil, days(5))), "PENDING");
  });

  it("valid finalized evidence: VERIFIED before validUntil, EXPIRED exactly at and after it", async () => {
    const b = await cohortBuilt({ lifecycle: "EXPIRING" });
    expectState(state(b, addMs(validUntil, -1000)), "VERIFIED");
    expectState(state(b, validUntil), "EXPIRED");
    expectState(state(b, addMs(validUntil, 1000)), "EXPIRED");
  });

  it("REVOKED and MODIFIED outrank EXPIRED", async () => {
    const b = await cohortBuilt({ lifecycle: "EXPIRING" });
    const after = addMs(validUntil, days(3));
    expectState(state({ ...b, ev: patched(b.ev, { revocation: { organisationId: b.org.id, revokerKeyOrganisationId: b.org.id, revokedAt: NOW, transaction: tx("REVOKE_CREDENTIAL") } }) }, after), "REVOKED");
    const successor = await signMaterial({ org: b.org, wallet: b.wallet, key: b.material.attestation.signerKey, lifecycle: "EXPIRING", issuedAt: addMs(ISSUED_AT, days(3)), supersedesCredentialId: b.material.credentialId });
    expectState(state({ ...b, ev: patched(b.ev, { successor }) }, after), "MODIFIED");
  });

  it("an anchor that is not final does not make it VERIFIED", async () => {
    expectState(state(await cohortBuilt({ lifecycle: "EXPIRING", anchorStatus: "CONFIRMED" })), "PENDING");
  });
});

describe("CONTINUING / ProofPulse", () => {
  const T1 = addMs(ISSUED_AT, days(2)); // first epoch
  const fresh = (anchoredAt = T1) => pulseBuilt({ steps: [{ t: "insert" }, { t: "anchor", at: anchoredAt }] });

  it("a fresh ACTIVE epoch -> CURRENTLY_ATTESTED, with the freshness deadline", async () => {
    const r = state(await fresh(), addMs(T1, days(10)));
    expectState(r, "CURRENTLY_ATTESTED");
    expect(r.freshnessDeadline).toEqual(addMs(T1, days(45)));
    expect(r.evidenceTimestamp).toEqual(T1);
    expect(r.evidenceSummary).toMatchObject({ attestationType: "PROOF_PULSE", anchorEpoch: 1, latestPulseEpoch: 1 });
    expect(r.checks.filter((c) => c.status === "FAIL")).toEqual([]);
  });

  it("freshness boundary: exactly 45 days is still current, one second later is STALE_NO_RECENT_ATTESTATION", async () => {
    const b = await fresh();
    expectState(state(b, addMs(T1, days(45))), "CURRENTLY_ATTESTED");
    const stale = state(b, addMs(T1, days(45) + 1000));
    expectState(stale, "STALE_NO_RECENT_ATTESTATION");
    expect(stale.freshnessDeadline).toEqual(addMs(T1, days(45)));
    expect(codes(stale)).toContain("STALE");
  });

  it("advancing time changes the state WITHOUT touching the evidence or the tree", async () => {
    const b = await fresh();
    const before = JSON.stringify(b.ev);
    const early = state(b, addMs(T1, days(1)));
    const late = state(b, addMs(T1, days(400)));
    expect([early.state, late.state]).toEqual(["CURRENTLY_ATTESTED", "STALE_NO_RECENT_ATTESTATION"]);
    expect(JSON.stringify(b.ev)).toBe(before);
    expect(b.ev.pulse!.log).toHaveLength(1); // no rebuild, no new root, no new epoch
  });

  it("the freshness window is the ORGANISATION's configured value", async () => {
    const b = await fresh();
    const now = addMs(T1, days(60));
    expectState(state(b, now, { ...POLICY, pulseFreshnessDays: 90 }), "CURRENTLY_ATTESTED");
    expectState(state(b, now, { ...POLICY, pulseFreshnessDays: 45 }), "STALE_NO_RECENT_ATTESTATION");
    expectState(state(b, addMs(T1, days(11)), { ...POLICY, pulseFreshnessDays: 10 }), "STALE_NO_RECENT_ATTESTATION");
  });

  it("a new epoch that re-affirms the unchanged root restores CURRENTLY_ATTESTED", async () => {
    const stale = await pulseBuilt({ steps: [{ t: "insert" }, { t: "anchor", at: T1 }] });
    const now = addMs(T1, days(60));
    expectState(state(stale, now), "STALE_NO_RECENT_ATTESTATION");
    const refreshed = await pulseBuilt({ steps: [{ t: "insert" }, { t: "anchor", at: T1 }, { t: "anchor", at: addMs(T1, days(55)) }] });
    const r = state(refreshed, now);
    expectState(r, "CURRENTLY_ATTESTED");
    expect(r.evidenceSummary.latestPulseEpoch).toBe(2);
    expect(r.freshnessDeadline).toEqual(addMs(T1, days(100)));
  });

  it("historical roots: an older epoch still verifies after the tree changed, and a non-final newer epoch is not used", async () => {
    const steps = [{ t: "insert" as const }, { t: "anchor" as const, at: T1 }, { t: "filler" as const }, { t: "anchor" as const, at: addMs(T1, days(30)) }];
    const b = await pulseBuilt({ steps });
    expect(new Set(b.ev.anchors.map((a) => a.batchRoot)).size).toBe(2); // the tree really changed between epochs
    const r = state(b, addMs(T1, days(31)));
    expectState(r, "CURRENTLY_ATTESTED");
    expect(r.evidenceSummary.latestPulseEpoch).toBe(2);

    const nonFinal = await pulseBuilt({ steps: [{ t: "insert" }, { t: "anchor", at: T1 }, { t: "filler" }, { t: "anchor", at: addMs(T1, days(30)), status: "CONFIRMED" }] });
    const r2 = state(nonFinal, addMs(T1, days(31)));
    expectState(r2, "CURRENTLY_ATTESTED");
    expect(r2.evidenceSummary.latestPulseEpoch).toBe(1);
    expect(r2.freshnessDeadline).toEqual(addMs(T1, days(45)));
  });

  it("not in the tree yet, or no epoch covers it yet -> PENDING", async () => {
    const b = await fresh();
    expectState(state({ ...b, ev: patched(b.ev, { pulse: null, anchors: [] }) }), "PENDING");
    expectState(state(await pulseBuilt({ steps: [{ t: "insert" }] })), "PENDING");
    // an epoch anchored BEFORE the credential was inserted does not cover it
    expectState(state(await pulseBuilt({ steps: [{ t: "filler" }, { t: "anchor", at: ISSUED_AT }, { t: "insert" }] })), "PENDING");
    expectState(state(await pulseBuilt({ steps: [{ t: "insert" }, { t: "anchor", at: T1, status: "CONFIRMED" }] })), "PENDING");
  });

  it("D7: the FIRST root containing the leaf must be anchored within 30 days; later epochs cannot rescue it", async () => {
    const lateFirst = await pulseBuilt({ steps: [{ t: "insert" }, { t: "anchor", at: addMs(ISSUED_AT, days(31)) }, { t: "anchor", at: addMs(ISSUED_AT, days(32)) }] });
    const r = state(lateFirst, addMs(ISSUED_AT, days(33)));
    expectState(r, "INVALID_PROOF");
    expect(codes(r)).toContain("ANCHOR_TOO_LATE");
    expectState(state(await pulseBuilt({ steps: [{ t: "insert" }, { t: "anchor", at: addMs(ISSUED_AT, days(30)) }] }), addMs(ISSUED_AT, days(31))), "CURRENTLY_ATTESTED");
  });

  describe("ENDED", () => {
    const endSteps = (at: Date, effective = addMs(ISSUED_AT, days(3))) =>
      [{ t: "insert" as const }, { t: "anchor" as const, at: T1 }, { t: "end" as const, issuedAt: at, effectiveAt: effective }, { t: "anchor" as const, at: addMs(at, days(1)) }];

    it("a valid signed end -> ENDED, even while the last epoch is fresh, and never REVOKED", async () => {
      const b = await pulseBuilt({ steps: endSteps(addMs(ISSUED_AT, days(4))) });
      const r = state(b, addMs(ISSUED_AT, days(6)));
      expectState(r, "ENDED");
      expect(r.endedAt).toEqual(addMs(ISSUED_AT, days(3)));
      expect(r.revokedAt).toBeNull();
      expect(r.evidenceSummary).toMatchObject({ ended: true, revoked: false });
      expect(codes(r)).toContain("ENDED");
      expect(codes(r)).not.toContain("REVOKED");
    });

    it("ENDED is effective immediately, before the next epoch is anchored", async () => {
      const b = await pulseBuilt({ steps: [{ t: "insert" }, { t: "anchor", at: T1 }, { t: "end", issuedAt: addMs(ISSUED_AT, days(4)), effectiveAt: addMs(ISSUED_AT, days(3)) }] });
      expectState(state(b, addMs(ISSUED_AT, days(5))), "ENDED");
      expectState(state(b, addMs(ISSUED_AT, days(500))), "ENDED"); // not STALE: ended is ended
    });

    it("ENDED even if the credential's first epoch was never anchored", async () => {
      const b = await pulseBuilt({ steps: [{ t: "insert" }, { t: "end", issuedAt: addMs(ISSUED_AT, days(1)), effectiveAt: addMs(ISSUED_AT, days(1)) }] });
      expectState(state(b), "ENDED");
    });

    it("a forged or invalid end is ignored: it can never change the state", async () => {
      const b = await pulseBuilt({ steps: endSteps(addMs(ISSUED_AT, days(4))) });
      const att = b.ev.statusChanges[0];
      const other = await signMaterial({ org: b.org, wallet: freshWallet(), key: att.signerKey, lifecycle: "CONTINUING" });
      const forged = patched(b.ev, { statusChanges: [{ ...att, signature: other.attestation.signature }] });
      const r = deriveCredentialState(forged, addMs(ISSUED_AT, days(6)), POLICY);
      expect(r.state).not.toBe("ENDED");
      expect(codes(r)).toContain("STATUS_CHANGE_IGNORED");
      // the unsigned-by-issuer end is also not honoured when the signer was not authorised at its time
      const unauth = patched(b.ev, { statusChanges: [{ ...att, signerKey: { ...att.signerKey, validFrom: addMs(att.issuedAt, 1000) } }] });
      expect(deriveCredentialState(unauth, addMs(ISSUED_AT, days(6)), POLICY).state).not.toBe("ENDED");
      // wrong sequence / not an ENDED change
      for (const patch of [{ statusSeq: 3 }, { newStatus: "ACTIVE" as const }, { organisationId: randomUUID() }]) {
        const r2 = deriveCredentialState(patched(b.ev, { statusChanges: [{ ...att, ...patch }] }), addMs(ISSUED_AT, days(6)), POLICY);
        expect(r2.state).not.toBe("ENDED");
      }
    });

    it("INVALID_PROOF still beats ENDED", async () => {
      const b = await pulseBuilt({ steps: endSteps(addMs(ISSUED_AT, days(4))) });
      expectState(deriveCredentialState(withMaterial(b.ev, { contentDigest: "0x" + "ab".repeat(32) }), NOW, POLICY), "INVALID_PROOF");
    });
  });

  describe("tampering with the pulse evidence -> INVALID_PROOF", () => {
    it("an anchored root that is not the root at its rootSeq", async () => {
      const b = await fresh();
      const a = b.ev.anchors[0];
      const other = "0x" + "bc".repeat(32);
      const r = deriveCredentialState(withAnchor(b.ev, 0, { batchRoot: other, chainRoot: chainRootOf(other, a.previousChainRoot, b.org.orgId, "PROOF_PULSE", 1n) }), NOW, POLICY);
      expectState(r, "INVALID_PROOF");
      expect(codes(r)).toContain("ANCHOR_ROOT_MISMATCH");
    });

    it("an anchor claiming a rootSeq beyond the recorded history", async () => {
      const b = await fresh();
      expectState(deriveCredentialState(withAnchor(b.ev, 0, { rootSeq: 99 }), NOW, POLICY), "INVALID_PROOF");
    });

    it("a corrupt update log (a recorded root that cannot be reproduced)", async () => {
      const b = await fresh();
      const log = b.ev.pulse!.log.map((e, i) => (i === 0 ? { ...e, newRoot: "0x" + "00".repeat(31) + "01" } : e));
      const r = deriveCredentialState(patched(b.ev, { pulse: { ...b.ev.pulse!, log } }), NOW, POLICY);
      expectState(r, "INVALID_PROOF");
      expect(codes(r)).toContain("PULSE_HISTORY_INCONSISTENT");
    });

    it("the leaf was inserted by a different attestation, or with a different leaf value", async () => {
      const b = await fresh();
      const wrongCause = b.ev.pulse!.log.map((e) => ({ ...e, causedByAttestationId: randomUUID() }));
      expectState(deriveCredentialState(patched(b.ev, { pulse: { ...b.ev.pulse!, log: wrongCause } }), NOW, POLICY), "INVALID_PROOF");
      const wrongLeaf = patched(b.ev, { pulse: { ...b.ev.pulse!, leaf: { ...b.ev.pulse!.leaf, scope: "MEMBERSHIP" } } });
      expectState(deriveCredentialState(wrongLeaf, NOW, POLICY), "INVALID_PROOF");
    });

    it("an anchor of another organisation's ProofPulse chain, a broken chain link, a bad signature", async () => {
      const b = await fresh();
      expectState(deriveCredentialState(withAnchor(b.ev, 0, { organisationId: randomUUID() }), NOW, POLICY), "INVALID_PROOF");
      expectState(deriveCredentialState(withAnchor(b.ev, 0, { chainRoot: "0x" + "ee".repeat(32) }), NOW, POLICY), "INVALID_PROOF");
      expectState(deriveCredentialState(withMaterial(b.ev, { attestation: { ...b.material.attestation, signature: "0x" + "00".repeat(65) } }), NOW, POLICY), "INVALID_PROOF");
    });

    it("a key compromised before the FIRST epoch was anchored", async () => {
      const b = await pulseBuilt({ keyOver: { compromisedAt: T1 } });
      expectState(state(b), "INVALID_PROOF");
      const ok = await pulseBuilt({ keyOver: { compromisedAt: addMs(T1, 1000) } });
      expectState(state(ok), "CURRENTLY_ATTESTED");
    });

    it("earlier epochs not yet synchronised is PENDING, not invalid", async () => {
      const b = await pulseBuilt({ steps: [{ t: "insert" }, { t: "anchor", at: T1 }, { t: "anchor", at: addMs(T1, days(5)) }] });
      const r = deriveCredentialState(patched(b.ev, { anchors: b.ev.anchors.filter((a) => a.epoch === 2) }), NOW, POLICY);
      expectState(r, "PENDING");
      expect(codes(r)).toContain("ANCHOR_CHAIN_INCOMPLETE");
    });
  });
});

describe("every state is reachable and precedence is total", () => {
  it("table: one scenario per public state", async () => {
    const T1 = addMs(ISSUED_AT, days(2));
    const claim = { claimId: randomUUID(), proposedLifecycleType: "PERMANENT" as const, requestInProgress: false, requestedOrganisation: null, credential: null };
    const permanent = await cohortBuilt();
    const expiring = await cohortBuilt({ lifecycle: "EXPIRING" });
    const pulse = await pulseBuilt({ steps: [{ t: "insert" }, { t: "anchor", at: T1 }] });
    const ended = await pulseBuilt({ steps: [{ t: "insert" }, { t: "anchor", at: T1 }, { t: "end", issuedAt: addMs(T1, days(1)), effectiveAt: addMs(T1, days(1)) }] });
    const successor = await signMaterial({ org: permanent.org, wallet: permanent.wallet, key: permanent.material.attestation.signerKey, lifecycle: "PERMANENT", issuedAt: addMs(ISSUED_AT, days(3)), supersedesCredentialId: permanent.material.credentialId });

    const table: [VerificationState, VerificationState][] = [
      [deriveClaimState(claim, NOW, POLICY).state, "SELF_DECLARED"],
      [deriveClaimState({ ...claim, requestInProgress: true }, NOW, POLICY).state, "PENDING"],
      [state(expiring).state, "VERIFIED"],
      [state(permanent).state, "PERMANENT_VALID"],
      [state(pulse, addMs(T1, days(1))).state, "CURRENTLY_ATTESTED"],
      [state(pulse, addMs(T1, days(100))).state, "STALE_NO_RECENT_ATTESTATION"],
      [state(expiring, new Date("2028-01-01T00:00:00Z")).state, "EXPIRED"],
      [state(ended, addMs(T1, days(3))).state, "ENDED"],
      [deriveCredentialState(patched(permanent.ev, { revocation: { organisationId: permanent.org.id, revokerKeyOrganisationId: permanent.org.id, revokedAt: NOW, transaction: tx("REVOKE_CREDENTIAL") } }), NOW, POLICY).state, "REVOKED"],
      [deriveCredentialState(patched(permanent.ev, { successor }), NOW, POLICY).state, "MODIFIED"],
      [deriveCredentialState(withMaterial(permanent.ev, { title: "x" } as never), NOW, POLICY).state, "PERMANENT_VALID"], // unknown field is inert
      [deriveCredentialState(withMaterial(permanent.ev, { credentialSalt: "0x" + "01".repeat(32) }), NOW, POLICY).state, "INVALID_PROOF"],
    ];
    for (const [actual, expected] of table) expect(actual).toBe(expected);
  });

  it("is deterministic and pure: the same inputs give the same result and evidence is never mutated", async () => {
    const b = await pulseBuilt();
    const before = JSON.stringify(b.ev);
    const a = JSON.stringify(state(b));
    expect(JSON.stringify(state(b))).toBe(a);
    expect(JSON.stringify(b.ev)).toBe(before);
  });
});

describe("privacy of the result", () => {
  it("never contains salts, claim content, signatures, nonces, the candidate id or any verified flag", async () => {
    const built = [await cohortBuilt(), await cohortBuilt({ lifecycle: "EXPIRING" }), await pulseBuilt()];
    for (const b of built) {
      const json = JSON.stringify(state(b));
      const m = b.material;
      for (const secret of [m.credentialSalt, m.contentSalt, m.subjectSalt, m.attestation.signature, m.attestation.nonce, m.candidateId, m.contentDigest, m.subjectCommitment, "Software Engineer", "Licensed Engineer"]) {
        expect(json).not.toContain(secret);
      }
      expect(Object.keys(state(b))).not.toEqual(expect.arrayContaining(["isVerified"]));
    }
  });

  it("the result type has no boolean verdict or score", async () => {
    const r = state(await cohortBuilt());
    for (const key of Object.keys(r)) expect(key).not.toMatch(/verified|score|trust|valid$/i);
  });
});
