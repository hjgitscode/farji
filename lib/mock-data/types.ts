// Shared domain types for Review 2 mock data.
// These mirror the enums/structs the Solidity contract and crypto layer
// will use from Phase 4 onward — kept in one place so every mock file and
// UI component agrees on the same shapes.

export type LifecycleType = "PERMANENT" | "CONTINUING" | "EXPIRING";

export type ClaimType =
  | "DEGREE"
  | "EMPLOYMENT"
  | "INTERNSHIP"
  | "CERTIFICATION"
  | "LICENCE";

export type CredentialState =
  | "SELF_DECLARED"
  | "PENDING"
  | "VERIFIED"
  | "PERMANENT_VALID"
  | "CURRENTLY_ATTESTED"
  | "STALE_NO_RECENT_ATTESTATION"
  | "EXPIRED"
  | "ENDED"
  | "REVOKED"
  | "MODIFIED"
  | "INVALID_PROOF";

export type AttestationType = "COHORT" | "PROOF_PULSE";

export type IssuerStatus = "ACTIVE" | "REVOKED";

export interface Organisation {
  organisationId: string;
  name: string;
  registeredAt: string; // ISO date
}

export interface IssuerKeyRecord {
  organisationId: string;
  wallet: string;
  validFrom: string; // ISO date
  validUntil: string | null; // null = still open-ended (not yet revoked)
  status: IssuerStatus;
}

export interface Candidate {
  candidateId: string;
  name: string;
}

export interface Credential {
  credentialId: string;
  candidateId: string;
  claimType: ClaimType;
  title: string;
  organisationId: string;
  lifecycleType: LifecycleType;
  version: number;
  previousVersionId: string | null;
  startDate: string; // ISO date
  endDate: string | null; // ISO date, only meaningful for EXPIRING/ended claims
  state: CredentialState;
  /**
   * The issuer wallet that signed this credential. Absent for claims that
   * have not yet been approved (SELF_DECLARED / PENDING) — an unapproved
   * claim has no issuer signature yet.
   */
  issuerWallet?: string;
  /** Set when this credential's PERMANENT status rests on a CohortProof batch. */
  cohortEpochId?: string;
  /** Set when this credential's CONTINUING status is tracked by a ProofPulse stream. */
  proofPulseStreamId?: string;
}

export interface Attestation {
  attestationId: string;
  organisationId: string;
  attestationType: AttestationType;
  epoch: number;
  label: string;
  leafCredentialIds: string[];
  batchRoot: string; // mock bytes32 hex — replaced by a real Merkle root in Phase 8
  previousChainRoot: string;
  chainRoot: string;
  anchoredAt: string; // ISO date
  issuerWallet: string;
}
