import { id as keccakUtf8, TypedDataEncoder } from "ethers";

// Cryptographic constants shared by the server, tests and (later) the browser verifier and
// Solidity golden vectors. Keccak-256, secp256k1 ECDSA, EIP-712 and Merkle trees are standard
// primitives; nothing here is novel. Pure: no I/O, no clock, no randomness.

/** keccak256 of the UTF-8 bytes of `s`. Used for every domain-separation tag. */
const TAG = (s: string): string => keccakUtf8(s);

export const CREDENTIAL_ID_TAG = TAG("FARJI_CREDENTIAL_ID_V1");
export const SUBJECT_TAG = TAG("FARJI_SUBJECT_V1");
export const COHORT_LEAF_V1 = TAG("FARJI_COHORT_LEAF_V1");
export const PULSE_LEAF_V1 = TAG("FARJI_PULSE_LEAF_V1");
export const PULSE_NODE_V1 = TAG("FARJI_PULSE_NODE_V1");
export const PULSE_EMPTY_V1 = TAG("FARJI_PULSE_EMPTY_V1");

export const ZERO_HASH = "0x" + "0".repeat(64);

// ─────────── Fixed enum codes (never derived from Prisma/TypeScript enum order) ───────────

export const CATEGORY_CODE = { EXPERIENCE: 0, EDUCATION: 1, CERTIFICATION: 2, MEMBERSHIP: 3 } as const;
export const LIFECYCLE_CODE = { PERMANENT: 0, CONTINUING: 1, EXPIRING: 2 } as const;
export const SCOPE_CODE = { EMPLOYMENT: 0, ENROLMENT: 1, MEMBERSHIP: 2 } as const;
export const PULSE_STATUS_CODE = { ACTIVE: 0, ENDED: 1 } as const;
/** Same order as the Solidity `AttestationType` enum (BLOCKCHAIN_MODEL §5). */
export const ATTESTATION_TYPE_CODE = { COHORT: 0, PROOF_PULSE: 1 } as const;

export type CategoryName = keyof typeof CATEGORY_CODE;
export type LifecycleName = keyof typeof LIFECYCLE_CODE;
export type ScopeName = keyof typeof SCOPE_CODE;
export type PulseStatusName = keyof typeof PULSE_STATUS_CODE;
export type AttestationTypeName = keyof typeof ATTESTATION_TYPE_CODE;

// ─────────── EIP-712 ───────────

export const EIP712_NAME = "FARJI";
export const EIP712_VERSION = "1";

export type TypedField = { name: string; type: string };
export type TypesRecord = Record<string, TypedField[]>;

/** The salted, canonical credential content. Its `hashStruct` is `contentDigest`. */
export const CREDENTIAL_CONTENT_FIELDS: TypedField[] = [
  { name: "category", type: "uint8" },
  { name: "title", type: "string" },
  { name: "organisationName", type: "string" },
  { name: "startDate", type: "string" },
  { name: "endDate", type: "string" },
  { name: "expiryDate", type: "string" },
  { name: "description", type: "string" },
  { name: "location", type: "string" },
  { name: "fieldOfStudy", type: "string" },
  { name: "credentialNumber", type: "string" },
  { name: "contentSalt", type: "bytes32" },
];

export const CONTENT_TYPES: TypesRecord = { CredentialContent: CREDENTIAL_CONTENT_FIELDS };

/**
 * `content` is a NESTED struct rather than a `bytes32 contentDigest`: the encoded value of a
 * nested struct is its `hashStruct`, which equals `contentDigest`, so digests are identical
 * while the issuer's wallet can display the actual title, dates and organisation (ROADMAP D39).
 */
export const CREDENTIAL_ATTESTATION_TYPES: TypesRecord = {
  CredentialAttestation: [
    { name: "credentialId", type: "bytes32" },
    { name: "orgId", type: "bytes32" },
    { name: "subjectCommitment", type: "bytes32" },
    { name: "content", type: "CredentialContent" },
    { name: "schemaId", type: "bytes32" },
    { name: "lifecycleType", type: "uint8" },
    // validFrom = the effective start of the underlying professional claim. NOT the signing time.
    { name: "validFrom", type: "uint64" },
    { name: "validUntil", type: "uint64" },
    { name: "supersedesCredentialId", type: "bytes32" },
    // issuedAt = the actual cryptographic issuance (signature) timestamp.
    { name: "issuedAt", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
  CredentialContent: CREDENTIAL_CONTENT_FIELDS,
};

export const STATUS_CHANGE_TYPES: TypesRecord = {
  StatusChangeAttestation: [
    { name: "credentialId", type: "bytes32" },
    { name: "orgId", type: "bytes32" },
    { name: "leafIndex", type: "uint32" },
    { name: "newStatus", type: "uint8" },
    { name: "effectiveAt", type: "uint64" },
    { name: "statusSeq", type: "uint32" },
    { name: "issuedAt", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
};

/**
 * Proof of possession of an issuer wallet (ROADMAP Phase 9, decision J): the connected wallet signs
 * this message to be bound as the operator of its IssuerKey. It binds the organisation, the member,
 * the wallet and a short-lived time + nonce, under the same FARJI domain (chain + registry).
 */
export const WALLET_BINDING_TYPES: TypesRecord = {
  FarjiWalletBinding: [
    { name: "orgId", type: "bytes32" },
    { name: "memberId", type: "bytes16" },
    { name: "wallet", type: "address" },
    { name: "issuedAt", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
};

/** The V1 content schema id: the type hash of `CredentialContent` (one universal V1 struct, D40). */
export const SCHEMA_ID = keccakUtf8(TypedDataEncoder.from(CONTENT_TYPES).encodeType("CredentialContent"));
