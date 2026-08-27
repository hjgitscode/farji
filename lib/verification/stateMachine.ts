import { hasDatePassed } from "./dateUtils";
import type { Credential, CredentialState } from "@/lib/mock-data/types";

/**
 * Everything the state machine needs to know that isn't already on the
 * credential itself — each of these is a fact the caller looks up
 * elsewhere (issuer registry, revocation registry, ProofPulse freshness,
 * version chain), never something this function reaches out and fetches
 * itself. That keeps deriveCredentialState a pure function: same inputs,
 * same answer, straightforward to unit test.
 */
export interface DeriveStateContext {
  /** The reference "today" used for expiry/freshness comparisons. */
  now: string;
  /** True once the credential has been revoked by its issuer. */
  isRevoked: boolean;
  /** True if a newer version of this same credential exists. */
  isSuperseded: boolean;
  /**
   * Was the signing wallet actually an authorised issuer at the
   * credential's startDate? `null` when the credential has no signature
   * yet (SELF_DECLARED / PENDING) — the question doesn't apply.
   */
  isIssuerAuthorisedAtIssuance: boolean | null;
  /** The most recent ProofPulse epoch for this credential's organisation, if any. */
  latestProofPulseEpoch?: {
    anchoredAt: string;
    /** Whether this specific credential's id appears in that epoch's batch. */
    includesCredential: boolean;
  };
  /** How many days a ProofPulse epoch counts as "recent" before going stale. */
  proofPulseFreshnessDays?: number;
}

const DEFAULT_FRESHNESS_DAYS = 45;

/**
 * Derives a credential's current verification state. This is the single
 * place that decision is made — nothing else in the app should set or
 * override `state` directly once a credential is signed. See
 * docs/ARCHITECTURE.md section 8 for the full state table this
 * implements.
 */
export function deriveCredentialState(credential: Credential, context: DeriveStateContext): CredentialState {
  // Not yet signed: SELF_DECLARED / PENDING are workflow stages, not
  // derivable from cryptographic or attestation facts, so pass through.
  if (!credential.issuerWallet) {
    return credential.state;
  }

  // Revocation is terminal and overrides every other consideration.
  if (context.isRevoked) {
    return "REVOKED";
  }

  // A signature from a wallet that was never actually authorised at
  // issuance time can't be trusted, no matter the lifecycle type.
  if (context.isIssuerAuthorisedAtIssuance === false) {
    return "INVALID_PROOF";
  }

  // A newer version exists — this one is historical evidence only.
  if (context.isSuperseded) {
    return "MODIFIED";
  }

  switch (credential.lifecycleType) {
    case "PERMANENT":
      return "PERMANENT_VALID";

    case "EXPIRING": {
      const expired = credential.endDate !== null && hasDatePassed(credential.endDate, context.now);
      return expired ? "EXPIRED" : "VERIFIED";
    }

    case "CONTINUING": {
      const explicitlyEnded = credential.endDate !== null && hasDatePassed(credential.endDate, context.now);
      if (explicitlyEnded) return "ENDED";

      if (!context.latestProofPulseEpoch) return "STALE_NO_RECENT_ATTESTATION";

      const freshnessDays = context.proofPulseFreshnessDays ?? DEFAULT_FRESHNESS_DAYS;
      const epochAgeDays = Math.abs(
        Math.round(
          (new Date(context.now).getTime() - new Date(context.latestProofPulseEpoch.anchoredAt).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );
      const isFresh = context.latestProofPulseEpoch.includesCredential && epochAgeDays <= freshnessDays;
      return isFresh ? "CURRENTLY_ATTESTED" : "STALE_NO_RECENT_ATTESTATION";
    }

    default:
      return credential.state;
  }
}
