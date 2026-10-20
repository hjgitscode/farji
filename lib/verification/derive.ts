import { deriveCredentialStateFromEvidence } from "./precedence";
import type { ClaimEvidence, CredentialEvidence, VerificationCheck, VerificationPolicy, VerificationResult } from "./types";

// Public entry points of the verification-state engine (ROADMAP Phase 10).
//
// Both functions are PURE: the same evidence, `now` and policy always give the same result, and nothing is
// read, written, cached or stored. There is no verified flag or score anywhere; the state exists only as the
// return value of these functions (DOMAIN_MODEL §6.4: any cache must carry its evidence watermark).

/** The derived state of one Credential (DOMAIN_MODEL §6.1). */
export function deriveCredentialState(evidence: CredentialEvidence, now: Date, policy: VerificationPolicy): VerificationResult {
  return deriveCredentialStateFromEvidence(evidence, now, policy);
}

const noEvidence = () => ({
  credentialId: null,
  evidenceTimestamp: null,
  freshnessDeadline: null,
  expiry: null,
  endedAt: null,
  revokedAt: null,
  checks: [] as VerificationCheck[],
  evidenceSummary: {
    signed: false,
    issuedAt: null,
    anchored: false,
    anchoredAt: null,
    anchorEpoch: null,
    attestationType: null,
    latestPulseEpoch: null,
    latestPulseAt: null,
    revoked: false,
    superseded: false,
    ended: false,
  },
});

/**
 * What a profile shows for one Claim (DOMAIN_MODEL §6.2): the state of the CURRENT version's Credential;
 * otherwise PENDING while a request is in progress; otherwise SELF_DECLARED (also after REJECTED / WITHDRAWN,
 * which are never exposed). Workflow statuses are inputs to PENDING only, never a state of their own.
 */
export function deriveClaimState(evidence: ClaimEvidence, now: Date, policy: VerificationPolicy): VerificationResult {
  if (evidence.credential) return deriveCredentialState(evidence.credential, now, policy);

  if (evidence.requestInProgress) {
    return {
      ...noEvidence(),
      state: "PENDING",
      lifecycleType: evidence.proposedLifecycleType,
      organisation: evidence.requestedOrganisation,
      reasons: [{ code: "REQUEST_IN_PROGRESS", message: "A verification request is in progress." }],
    };
  }
  return {
    ...noEvidence(),
    state: "SELF_DECLARED",
    lifecycleType: evidence.proposedLifecycleType,
    organisation: null,
    reasons: [{ code: "NO_REQUEST", message: "This record has not been verified by any organisation." }],
  };
}
