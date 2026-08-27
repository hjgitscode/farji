import { credentials as allCredentials } from "@/lib/mock-data/credentials";
import { DEMO_REFERENCE_DATE } from "@/lib/mock-data/referenceDate";
import { getLatestAttestation } from "@/lib/services/attestationService";
import { isIssuerValidAt } from "@/lib/services/issuerService";
import { deriveCredentialState } from "@/lib/verification/stateMachine";
import type { Credential, CredentialState } from "@/lib/mock-data/types";

function isSuperseded(credential: Credential): boolean {
  return allCredentials.some((other) => other.previousVersionId === credential.credentialId);
}

/**
 * The date an issuer's signature on this credential should be checked
 * against for historical validity. For a PERMANENT credential
 * representing a completed fact (a degree, a finished internship), the
 * issuer attests to it once it's over — at endDate, not startDate (you
 * don't get a degree certificate the day you enrol). CONTINUING and
 * EXPIRING credentials are attested at the point they begin, so
 * startDate is correct for those.
 */
export function getIssuanceReferenceDate(credential: Credential): string {
  if (credential.lifecycleType === "PERMANENT") {
    return credential.endDate ?? credential.startDate;
  }
  return credential.startDate;
}

/** The most recent ProofPulse epoch for this credential's org, and whether this credential is in it. */
export function getLatestProofPulseInfo(credential: Credential) {
  if (credential.lifecycleType !== "CONTINUING") return undefined;

  const latest = getLatestAttestation(credential.organisationId, "PROOF_PULSE");
  if (!latest) return undefined;

  return {
    anchoredAt: latest.anchoredAt,
    includesCredential: latest.leafCredentialIds.includes(credential.credentialId),
  };
}

/**
 * Computes a credential's real, derived verification state. This is the
 * one function every part of the app should call instead of trusting a
 * credential's stored `state` field directly — see
 * lib/verification/stateMachine.ts for the actual state table.
 */
export function computeCredentialState(credential: Credential): CredentialState {
  const isRevoked = credential.state === "REVOKED";
  const isIssuerAuthorisedAtIssuance = credential.issuerWallet
    ? isIssuerValidAt(credential.issuerWallet, getIssuanceReferenceDate(credential))
    : null;

  return deriveCredentialState(credential, {
    now: DEMO_REFERENCE_DATE,
    isRevoked,
    isSuperseded: isSuperseded(credential),
    isIssuerAuthorisedAtIssuance,
    latestProofPulseEpoch: getLatestProofPulseInfo(credential),
  });
}

/** Returns a copy of `credential` with `state` replaced by the derived value. */
export function withComputedState(credential: Credential): Credential {
  return { ...credential, state: computeCredentialState(credential) };
}
