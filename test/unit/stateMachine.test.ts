import { describe, expect, it } from "vitest";
import { deriveCredentialState } from "@/lib/verification/stateMachine";
import type { Credential } from "@/lib/mock-data/types";

const baseCredential: Credential = {
  credentialId: "CRED-TEST",
  candidateId: "CAND-TEST",
  claimType: "EMPLOYMENT",
  title: "Test Role",
  organisationId: "ORG-TEST",
  lifecycleType: "CONTINUING",
  version: 1,
  previousVersionId: null,
  startDate: "2026-01-01",
  endDate: null,
  state: "PENDING",
};

const NOW = "2026-09-10";

describe("deriveCredentialState — unsigned credentials", () => {
  it("passes through SELF_DECLARED unchanged", () => {
    const credential = { ...baseCredential, state: "SELF_DECLARED" as const };
    const state = deriveCredentialState(credential, {
      now: NOW,
      isRevoked: false,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: null,
    });
    expect(state).toBe("SELF_DECLARED");
  });

  it("passes through PENDING unchanged", () => {
    const credential = { ...baseCredential, state: "PENDING" as const };
    const state = deriveCredentialState(credential, {
      now: NOW,
      isRevoked: false,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: null,
    });
    expect(state).toBe("PENDING");
  });
});

describe("deriveCredentialState — terminal overrides", () => {
  const signed: Credential = { ...baseCredential, issuerWallet: "0xIssuer" };

  it("revocation overrides everything else", () => {
    const state = deriveCredentialState(signed, {
      now: NOW,
      isRevoked: true,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: true,
    });
    expect(state).toBe("REVOKED");
  });

  it("an issuer not authorised at issuance yields INVALID_PROOF", () => {
    const state = deriveCredentialState(signed, {
      now: NOW,
      isRevoked: false,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: false,
    });
    expect(state).toBe("INVALID_PROOF");
  });

  it("a superseded version yields MODIFIED", () => {
    const state = deriveCredentialState(signed, {
      now: NOW,
      isRevoked: false,
      isSuperseded: true,
      isIssuerAuthorisedAtIssuance: true,
    });
    expect(state).toBe("MODIFIED");
  });

  it("revocation takes priority over an invalid-issuer signature", () => {
    const state = deriveCredentialState(signed, {
      now: NOW,
      isRevoked: true,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: false,
    });
    expect(state).toBe("REVOKED");
  });
});

describe("deriveCredentialState — PERMANENT", () => {
  it("is PERMANENT_VALID once signed by an authorised issuer", () => {
    const credential: Credential = {
      ...baseCredential,
      lifecycleType: "PERMANENT",
      issuerWallet: "0xIssuer",
      endDate: "2026-06-01",
    };
    const state = deriveCredentialState(credential, {
      now: NOW,
      isRevoked: false,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: true,
    });
    expect(state).toBe("PERMANENT_VALID");
  });
});

describe("deriveCredentialState — EXPIRING", () => {
  const credential: Credential = {
    ...baseCredential,
    lifecycleType: "EXPIRING",
    issuerWallet: "0xIssuer",
    endDate: "2027-02-01",
  };

  it("is VERIFIED before the expiry date", () => {
    const state = deriveCredentialState(credential, {
      now: "2026-09-10",
      isRevoked: false,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: true,
    });
    expect(state).toBe("VERIFIED");
  });

  it("is EXPIRED on and after the expiry date", () => {
    const onExpiry = deriveCredentialState(credential, {
      now: "2027-02-01",
      isRevoked: false,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: true,
    });
    const afterExpiry = deriveCredentialState(credential, {
      now: "2027-03-01",
      isRevoked: false,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: true,
    });
    expect(onExpiry).toBe("EXPIRED");
    expect(afterExpiry).toBe("EXPIRED");
  });
});

describe("deriveCredentialState — CONTINUING", () => {
  const active: Credential = {
    ...baseCredential,
    lifecycleType: "CONTINUING",
    issuerWallet: "0xIssuer",
    endDate: null,
  };

  it("is CURRENTLY_ATTESTED when the latest ProofPulse is recent and includes it", () => {
    const state = deriveCredentialState(active, {
      now: NOW,
      isRevoked: false,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: true,
      latestProofPulseEpoch: { anchoredAt: "2026-09-01", includesCredential: true },
    });
    expect(state).toBe("CURRENTLY_ATTESTED");
  });

  it("is STALE_NO_RECENT_ATTESTATION when the latest ProofPulse excludes it", () => {
    const state = deriveCredentialState(active, {
      now: NOW,
      isRevoked: false,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: true,
      latestProofPulseEpoch: { anchoredAt: "2026-09-01", includesCredential: false },
    });
    expect(state).toBe("STALE_NO_RECENT_ATTESTATION");
  });

  it("is STALE_NO_RECENT_ATTESTATION when the latest epoch is too old", () => {
    const state = deriveCredentialState(active, {
      now: NOW,
      isRevoked: false,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: true,
      latestProofPulseEpoch: { anchoredAt: "2025-01-01", includesCredential: true },
      proofPulseFreshnessDays: 45,
    });
    expect(state).toBe("STALE_NO_RECENT_ATTESTATION");
  });

  it("is STALE_NO_RECENT_ATTESTATION when there is no ProofPulse epoch at all", () => {
    const state = deriveCredentialState(active, {
      now: NOW,
      isRevoked: false,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: true,
    });
    expect(state).toBe("STALE_NO_RECENT_ATTESTATION");
  });

  it("is ENDED once an explicit end date has passed, even with a fresh ProofPulse", () => {
    const ended: Credential = { ...active, endDate: "2026-06-01" };
    const state = deriveCredentialState(ended, {
      now: NOW,
      isRevoked: false,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: true,
      latestProofPulseEpoch: { anchoredAt: "2026-09-01", includesCredential: true },
    });
    expect(state).toBe("ENDED");
  });

  it("absence from ProofPulse alone never produces ENDED", () => {
    const state = deriveCredentialState(active, {
      now: NOW,
      isRevoked: false,
      isSuperseded: false,
      isIssuerAuthorisedAtIssuance: true,
      latestProofPulseEpoch: { anchoredAt: "2026-09-01", includesCredential: false },
    });
    expect(state).not.toBe("ENDED");
  });
});
