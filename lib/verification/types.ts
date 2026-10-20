import type { CategoryName, LifecycleName, AttestationTypeName } from "@/lib/crypto/constants";
import type { Eip712Config } from "@/lib/crypto/eip712";
import type { PulseLogEntry } from "@/lib/merkle/pulse";

// Verification-state engine types (DOMAIN_MODEL §6, ROADMAP Phase 10). Pure: no I/O, no clock.
//
// The engine is given a bundle of RAW evidence (rows as the database mirror holds them), a policy and
// `now`. It recomputes every hash, signature and Merkle fold itself, so no stored flag, pipeline status
// or cached value is ever trusted as proof. The result carries NO private material (salts, claim
// content, reviewer notes, source-of-truth references, audit metadata).

export const VERIFICATION_STATES = [
  "SELF_DECLARED",
  "PENDING",
  "VERIFIED",
  "PERMANENT_VALID",
  "CURRENTLY_ATTESTED",
  "STALE_NO_RECENT_ATTESTATION",
  "EXPIRED",
  "ENDED",
  "REVOKED",
  "MODIFIED",
  "INVALID_PROOF",
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/** States that assert a current or historical positive verification (never shown without evidence). */
export const POSITIVE_STATES: readonly VerificationState[] = ["VERIFIED", "PERMANENT_VALID", "CURRENTLY_ATTESTED"];

// ───────────────────────────── policy ─────────────────────────────

export type VerificationPolicy = {
  /** ROADMAP D7: a signed attestation must be first anchored within this long of its `issuedAt`. */
  maxAnchorDelayMs: number;
  /** The ISSUING ORGANISATION's configured freshness window (`Organisation.pulseFreshnessDays`). */
  pulseFreshnessDays: number;
  /** The EIP-712 domain every attestation must have been signed under (chain id + registry). No default. */
  domain: Eip712Config;
};

// ───────────────────────────── evidence input ─────────────────────────────

export type TxEvidence = {
  /** Only a FINALIZED transaction is positive evidence (D17). */
  status: "PENDING" | "CONFIRMED" | "FINALIZED" | "FAILED" | "DROPPED";
  purpose: string;
  chainId: number;
};

export type KeyEvidence = {
  id: string;
  organisationId: string;
  /** Lowercase 0x address. */
  walletAddress: string;
  validFrom: Date;
  validUntil: Date | null;
  compromisedAt: Date | null;
  /** The key's authorisation transaction is FINALIZED (D46). A hand-made mirror row is not authority. */
  authorisationFinalized: boolean;
};

export type AttestationEvidence = {
  id: string;
  organisationId: string;
  signature: string;
  typedDataHash: string;
  nonce: string;
  issuedAt: Date;
  chainId: number;
  verifyingContract: string;
  signerKey: KeyEvidence;
  /** STATUS_CHANGE only. */
  statusSeq: number | null;
  newStatus: "ACTIVE" | "ENDED" | null;
  effectiveAt: Date | null;
};

/** Everything needed to RECOMPUTE a credential's signed message. Private: never copied into a result. */
export type SignedMaterial = {
  organisationId: string;
  /** The Organisation's bytes32 `orgId`. */
  orgId: string;
  lifecycleType: LifecycleName;
  category: CategoryName;
  /** Stored ClaimVersion.content (candidate data) - used only to recompute the digest. */
  claimContent: unknown;
  candidateId: string;
  credentialSalt: string;
  contentSalt: string;
  subjectSalt: string;
  credentialId: string;
  subjectCommitment: string;
  contentDigest: string;
  validFrom: Date;
  validUntil: Date | null;
  issuedAt: Date;
  /** bytes32 credentialId of the predecessor in the signed message, or the zero hash. */
  supersedesCredentialId: string;
  /** The CREDENTIAL attestation. */
  attestation: AttestationEvidence;
};

export type AnchorEvidence = {
  id: string;
  organisationId: string;
  attestationType: AttestationTypeName;
  epoch: number;
  batchRoot: string;
  previousChainRoot: string;
  chainRoot: string;
  /** PROOF_PULSE only. */
  rootSeq: number | null;
  leafCount: number;
  /** The organisation of the wallet that submitted the anchor. */
  anchorerKeyOrganisationId: string;
  /** The block timestamp: the moment the anchor became evidence (`anchoredAt`). */
  blockTimestamp: Date;
  transaction: TxEvidence;
};

export type CohortEvidence = {
  leafHash: string;
  /** Stored sibling path, written once at sealing. Null while the batch is still OPEN. */
  proof: { siblings: string[] } | null;
  batch: { status: "OPEN" | "SEALED" | "ANCHORED"; batchRoot: string | null; leafCount: number | null; anchorId: string | null };
};

export type PulseEvidence = {
  depth: number;
  leaf: { leafIndex: number; scope: "EMPLOYMENT" | "ENROLMENT" | "MEMBERSHIP" };
  /** The tree's append-only update log from rootSeq 1 (permanent root history). */
  log: (PulseLogEntry & { kind: "INSERT" | "STATUS_CHANGE"; leafIndex: number; causedByAttestationId: string })[];
};

export type RevocationEvidence = {
  organisationId: string;
  revokerKeyOrganisationId: string;
  revokedAt: Date;
  transaction: TxEvidence;
};

export type CredentialEvidence = {
  rowId: string;
  organisation: { id: string; displayName: string };
  lifecycleType: LifecycleName;
  /** Workflow says the credential is past AWAITING_SIGNATURE. Only used to detect MISSING evidence. */
  workflowSigned: boolean;
  /** Null when no CREDENTIAL attestation exists. */
  signed: SignedMaterial | null;
  /** The mirrored anchors of the credential's organisation and type that the loader found. */
  cohort: CohortEvidence | null;
  pulse: PulseEvidence | null;
  /** All COHORT or PROOF_PULSE anchors of the organisation (the engine selects and validates). */
  anchors: AnchorEvidence[];
  /** STATUS_CHANGE attestations recorded for this credential. */
  statusChanges: AttestationEvidence[];
  revocation: RevocationEvidence | null;
  /** The credential that names this one in `supersedesCredentialId`, with its signed material. */
  successor: SignedMaterial | null;
};

export type ClaimEvidence = {
  claimId: string;
  proposedLifecycleType: LifecycleName;
  /** The current ClaimVersion has an open (SUBMITTED / IN_REVIEW) or APPROVED request. */
  requestInProgress: boolean;
  /** The organisation named by that in-progress request (display only). */
  requestedOrganisation: { id: string; displayName: string } | null;
  /** The Credential of the CURRENT ClaimVersion, if any. */
  credential: CredentialEvidence | null;
};

// ───────────────────────────── result ─────────────────────────────

export type CheckId =
  | "ATTESTATION_PRESENT"
  | "CREDENTIAL_ID"
  | "CANONICAL_CONTENT"
  | "CONTENT_DIGEST"
  | "SUBJECT_COMMITMENT"
  | "CREDENTIAL_DATES"
  | "SIGNED_MESSAGE"
  | "SIGNATURE"
  | "SIGNER_ORGANISATION"
  | "SIGNER_AUTHORISED_AT_ISSUANCE"
  | "SIGNER_AUTHORISATION_FINAL"
  | "SIGNER_NOT_COMPROMISED_AT_ANCHOR"
  | "MERKLE_LEAF"
  | "MERKLE_PROOF"
  | "ANCHOR_PRESENT"
  | "ANCHOR_FINAL"
  | "ANCHOR_ORGANISATION"
  | "ANCHOR_CHAIN"
  | "ANCHOR_ROOT"
  | "ANCHOR_CHAIN_CONTINUITY"
  | "ANCHOR_WINDOW"
  | "PULSE_HISTORY"
  | "PULSE_LEAF"
  | "PULSE_FRESHNESS"
  | "STATUS_CHANGE"
  | "REVOCATION"
  | "SUPERSESSION"
  | "EXPIRY";

export type CheckStatus = "PASS" | "FAIL" | "PENDING" | "NOT_APPLICABLE";

export type VerificationCheck = { id: CheckId; status: CheckStatus; detail: string };

export type ReasonCode =
  // workflow (A)
  | "NO_REQUEST"
  | "REQUEST_IN_PROGRESS"
  | "AWAITING_SIGNATURE"
  | "AWAITING_ANCHOR"
  | "ANCHOR_NOT_FINAL"
  | "ANCHOR_CHAIN_INCOMPLETE"
  | "ANCHOR_WINDOW_ELAPSED"
  // negative / terminal
  | "REVOKED"
  | "SUPERSEDED"
  | "ENDED"
  | "EXPIRED"
  | "STALE"
  // integrity failures (C)
  | "ATTESTATION_MISSING"
  | "SIGNED_MATERIAL_MISMATCH"
  | "SIGNATURE_INVALID"
  | "SIGNER_NOT_AUTHORISED"
  | "SIGNER_AUTHORISATION_NOT_FINAL"
  | "SIGNER_ORGANISATION_MISMATCH"
  | "SIGNER_COMPROMISED"
  | "MERKLE_PROOF_INVALID"
  | "ANCHOR_ORGANISATION_MISMATCH"
  | "ANCHOR_CHAIN_MISMATCH"
  | "ANCHOR_ROOT_MISMATCH"
  | "ANCHOR_CHAIN_BROKEN"
  | "ANCHOR_TOO_LATE"
  | "ANCHOR_BEFORE_ISSUANCE"
  | "PULSE_HISTORY_INCONSISTENT"
  // ignored evidence (raises an integrity note but never changes the state upward)
  | "REVOCATION_NOT_FINAL"
  | "REVOCATION_IGNORED"
  | "STATUS_CHANGE_IGNORED"
  | "SUCCESSOR_IGNORED"
  // positive
  | "VALID_PERMANENT"
  | "VALID_EXPIRING"
  | "CURRENT_PULSE";

export type VerificationReason = { code: ReasonCode; message: string };

export type EvidenceSummary = {
  signed: boolean;
  issuedAt: Date | null;
  /** Null when the anchor path was not assessed (a revoked credential short-circuits). */
  anchored: boolean | null;
  anchoredAt: Date | null;
  anchorEpoch: number | null;
  attestationType: AttestationTypeName | null;
  /** CONTINUING: the most recent finalized epoch that proved the leaf ACTIVE. */
  latestPulseEpoch: number | null;
  latestPulseAt: Date | null;
  revoked: boolean;
  superseded: boolean;
  ended: boolean;
};

export type VerificationResult = {
  state: VerificationState;
  /** For an unsigned claim this is the candidate's PROPOSED type; otherwise the credential's authoritative type. */
  lifecycleType: LifecycleName | null;
  credentialId: string | null;
  organisation: { id: string; displayName: string } | null;
  /** When the deciding evidence became evidence (anchor time, revocation time, end effective time). */
  evidenceTimestamp: Date | null;
  /** CONTINUING: the instant the latest ProofPulse evidence stops being fresh. */
  freshnessDeadline: Date | null;
  /** EXPIRING: the credential's `validUntil`. */
  expiry: Date | null;
  endedAt: Date | null;
  revokedAt: Date | null;
  reasons: VerificationReason[];
  /** The full check list for a "View verification details" panel. */
  checks: VerificationCheck[];
  evidenceSummary: EvidenceSummary;
};
