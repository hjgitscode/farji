import { getCredentialById } from "@/lib/services/candidateService";
import { getOrganisationById } from "@/lib/services/organisationService";
import { isIssuerValidAt } from "@/lib/services/issuerService";
import { getAttestationById, getLatestAttestation } from "@/lib/services/attestationService";
import { placeholderHex } from "@/lib/mock-data/mockHex";
import { hashCredential } from "@/lib/crypto/hash";
import { toCanonicalInput } from "@/lib/crypto/fromMockCredential";
import type { Credential, CredentialState, Organisation } from "@/lib/mock-data/types";

// Builds the aggregated report the public recruiter verification page
// renders. claimHash is real Keccak-256 as of Phase 4; signature and
// merkleProof are still placeholders until Phases 5 and 8 respectively —
// but this function's shape, and therefore the UI built against it,
// does not need to change as each becomes real.

export interface TechnicalProof {
  claimHash: string;
  issuerWallet: string;
  signature: string;
  merkleRoot: string | null;
  merkleProof: string[];
  batchEpoch: number | null;
  previousChainRoot: string | null;
  currentChainRoot: string | null;
  contractAddress: string;
  chainReference: string;
}

export interface VerificationResult {
  credential: Credential;
  organisation: Organisation | undefined;
  issuerSignatureValid: boolean | null;
  claimIntegrityUnchanged: boolean | null;
  issuerAuthorisedAtIssuance: boolean | null;
  cohortProof: "VALID" | "N/A";
  latestProofPulse: "CURRENT" | "STALE" | "N/A";
  blockchainAnchor: "CONFIRMED" | "NOT_YET_ANCHORED";
  historicalChainIntact: boolean | null;
  revoked: boolean;
  currentState: CredentialState;
  technicalProof: TechnicalProof | null;
}

export function buildVerificationResult(credentialId: string): VerificationResult | undefined {
  const credential = getCredentialById(credentialId);
  if (!credential) return undefined;

  const organisation = getOrganisationById(credential.organisationId);
  const notYetSigned = !credential.issuerWallet;

  const issuerAuthorisedAtIssuance = notYetSigned
    ? null
    : isIssuerValidAt(credential.issuerWallet as string, credential.startDate);

  const cohortProof: "VALID" | "N/A" = credential.cohortEpochId ? "VALID" : "N/A";

  let latestProofPulse: "CURRENT" | "STALE" | "N/A" = "N/A";
  if (credential.lifecycleType === "CONTINUING" && credential.state !== "ENDED") {
    latestProofPulse = credential.state === "CURRENTLY_ATTESTED" ? "CURRENT" : "STALE";
  }

  const cohortAttestation = credential.cohortEpochId
    ? getAttestationById(credential.cohortEpochId)
    : undefined;
  const proofPulseAttestation =
    credential.lifecycleType === "CONTINUING"
      ? getLatestAttestation(credential.organisationId, "PROOF_PULSE")
      : undefined;
  const relevantAttestation = cohortAttestation ?? proofPulseAttestation;

  const technicalProof: TechnicalProof | null = notYetSigned
    ? null
    : {
        claimHash: hashCredential(toCanonicalInput(credential)),
        issuerWallet: credential.issuerWallet as string,
        signature: placeholderHex(`sig-${credential.credentialId}`),
        merkleRoot: relevantAttestation?.batchRoot ?? null,
        merkleProof: relevantAttestation
          ? [placeholderHex(`${credential.credentialId}-p1`), placeholderHex(`${credential.credentialId}-p2`)]
          : [],
        batchEpoch: relevantAttestation?.epoch ?? null,
        previousChainRoot: relevantAttestation?.previousChainRoot ?? null,
        currentChainRoot: relevantAttestation?.chainRoot ?? null,
        contractAddress: "Not yet deployed — arrives in Phase 6",
        chainReference: "Local Hardhat network — anchored on-chain from Phase 6 onward",
      };

  return {
    credential,
    organisation,
    issuerSignatureValid: notYetSigned ? null : true,
    claimIntegrityUnchanged: notYetSigned ? null : true,
    issuerAuthorisedAtIssuance,
    cohortProof,
    latestProofPulse,
    blockchainAnchor: notYetSigned ? "NOT_YET_ANCHORED" : "CONFIRMED",
    historicalChainIntact: notYetSigned ? null : true,
    revoked: credential.state === "REVOKED",
    currentState: credential.state,
    technicalProof,
  };
}
