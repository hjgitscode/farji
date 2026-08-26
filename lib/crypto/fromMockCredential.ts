import type { Credential } from "@/lib/mock-data/types";
import type { CanonicalCredentialInput } from "./types";

/**
 * Bridges the UI-facing mock Credential (lib/mock-data) into the
 * canonicalisation input shape. The only real difference is naming:
 * the domain model calls it candidateId, the canonical format (matching
 * the project's on-the-wire credential spec) calls it candidateRef.
 */
export function toCanonicalInput(credential: Credential): CanonicalCredentialInput {
  return {
    credentialId: credential.credentialId,
    candidateRef: credential.candidateId,
    claimType: credential.claimType,
    organisationId: credential.organisationId,
    title: credential.title,
    startDate: credential.startDate,
    endDate: credential.endDate,
    lifecycleType: credential.lifecycleType,
    version: credential.version,
  };
}
