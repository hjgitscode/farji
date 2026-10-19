import { getAddress, Signature, TypedDataEncoder, verifyTypedData } from "ethers";
import type { CanonicalContent } from "./canonical";
import { saltedContent } from "./commitments";
import {
  CREDENTIAL_ATTESTATION_TYPES,
  EIP712_NAME,
  EIP712_VERSION,
  SCHEMA_ID,
  STATUS_CHANGE_TYPES,
  type TypesRecord,
} from "./constants";
import { isBytes32, isLowerAddress } from "./encoding";

// EIP-712 typed data for issuer attestations (BLOCKCHAIN_MODEL §10, ROADMAP D39). Pure.
//
// There is NO function here that holds or accepts a private key: this module only BUILDS typed
// data and RECOVERS signers. Signing is done by a wallet (browser wallet in production,
// a test wallet in tests/fixtures).

export type Eip712Config = { chainId: bigint; verifyingContract: string };

export type Eip712Domain = { name: string; version: string; chainId: bigint; verifyingContract: string };

export type TypedData<M extends Record<string, unknown>> = {
  domain: Eip712Domain;
  types: TypesRecord;
  primaryType: string;
  message: M;
};

export function farjiDomain(config: Eip712Config): Eip712Domain {
  if (config.chainId <= 0n) throw new Error("chainId must be positive");
  if (!isLowerAddress(config.verifyingContract)) throw new Error("verifyingContract must be a lowercase 0x address");
  return { name: EIP712_NAME, version: EIP712_VERSION, chainId: config.chainId, verifyingContract: config.verifyingContract };
}

export type CredentialAttestationParams = {
  credentialId: string;
  orgId: string;
  subjectCommitment: string;
  content: CanonicalContent;
  contentSalt: string;
  lifecycleType: number;
  /** Effective start of the underlying professional claim (unix seconds). NOT the signing time. */
  validFrom: bigint;
  /** Expiry (unix seconds) for EXPIRING credentials, otherwise 0n. */
  validUntil: bigint;
  supersedesCredentialId: string;
  /** The actual cryptographic issuance (signature) timestamp, unix seconds. */
  issuedAt: bigint;
  nonce: string;
};

export type CredentialAttestationMessage = {
  credentialId: string;
  orgId: string;
  subjectCommitment: string;
  content: CanonicalContent & { contentSalt: string };
  schemaId: string;
  lifecycleType: number;
  validFrom: bigint;
  validUntil: bigint;
  supersedesCredentialId: string;
  issuedAt: bigint;
  nonce: string;
};

const U64 = (1n << 64n) - 1n;

function need32(name: string, v: string) {
  if (!isBytes32(v)) throw new Error(`${name} must be a lowercase 0x bytes32`);
}
function needU64(name: string, v: bigint) {
  if (v < 0n || v > U64) throw new Error(`${name} must fit uint64`);
}

export function buildCredentialTypedData(domain: Eip712Domain, p: CredentialAttestationParams): TypedData<CredentialAttestationMessage> {
  for (const [n, v] of [
    ["credentialId", p.credentialId],
    ["orgId", p.orgId],
    ["subjectCommitment", p.subjectCommitment],
    ["supersedesCredentialId", p.supersedesCredentialId],
    ["nonce", p.nonce],
  ] as const) {
    need32(n, v);
  }
  needU64("validFrom", p.validFrom);
  needU64("validUntil", p.validUntil);
  needU64("issuedAt", p.issuedAt);
  if (![0, 1, 2].includes(p.lifecycleType)) throw new Error("lifecycleType must be 0, 1 or 2");
  return {
    domain,
    types: CREDENTIAL_ATTESTATION_TYPES,
    primaryType: "CredentialAttestation",
    message: {
      credentialId: p.credentialId,
      orgId: p.orgId,
      subjectCommitment: p.subjectCommitment,
      content: saltedContent(p.content, p.contentSalt),
      schemaId: SCHEMA_ID,
      lifecycleType: p.lifecycleType,
      validFrom: p.validFrom,
      validUntil: p.validUntil,
      supersedesCredentialId: p.supersedesCredentialId,
      issuedAt: p.issuedAt,
      nonce: p.nonce,
    },
  };
}

export type StatusChangeParams = {
  credentialId: string;
  orgId: string;
  leafIndex: number;
  newStatus: number;
  effectiveAt: bigint;
  statusSeq: number;
  issuedAt: bigint;
  nonce: string;
};

export type StatusChangeMessage = StatusChangeParams;

export function buildStatusChangeTypedData(domain: Eip712Domain, p: StatusChangeParams): TypedData<StatusChangeMessage> {
  need32("credentialId", p.credentialId);
  need32("orgId", p.orgId);
  need32("nonce", p.nonce);
  needU64("effectiveAt", p.effectiveAt);
  needU64("issuedAt", p.issuedAt);
  if (!Number.isInteger(p.leafIndex) || p.leafIndex < 0 || p.leafIndex > 0xffffffff) throw new Error("leafIndex must fit uint32");
  if (!Number.isInteger(p.statusSeq) || p.statusSeq < 1 || p.statusSeq > 0xffffffff) throw new Error("statusSeq must be a uint32 >= 1");
  if (![0, 1].includes(p.newStatus)) throw new Error("newStatus must be 0 or 1");
  return { domain, types: STATUS_CHANGE_TYPES, primaryType: "StatusChangeAttestation", message: { ...p } };
}

/** EIP-712 digest: keccak256(0x1901 ‖ domainSeparator ‖ hashStruct(message)). */
export function typedDataHash(td: TypedData<Record<string, unknown>>): string {
  return TypedDataEncoder.hash(td.domain, td.types, td.message);
}

const SIGNATURE_HEX = /^0x[0-9a-fA-F]{130}$/;

/**
 * Accepts only a canonical 65-byte secp256k1 signature: r ‖ s ‖ v with v ∈ {27, 28} and low s
 * (rejects the malleable high-s twin). Returns the lowercase serialisation, or null.
 */
export function normaliseSignature(signature: unknown): string | null {
  if (typeof signature !== "string" || !SIGNATURE_HEX.test(signature)) return null;
  const v = parseInt(signature.slice(130, 132), 16);
  if (v !== 27 && v !== 28) return null;
  try {
    return Signature.from(signature).serialized.toLowerCase();
  } catch {
    return null; // e.g. non-canonical (high) s
  }
}

/** Recovers the lowercase signer address, or null if the signature is malformed or unrecoverable. */
export function recoverSigner(td: TypedData<Record<string, unknown>>, signature: string): string | null {
  const normalised = normaliseSignature(signature);
  if (!normalised) return null;
  try {
    return verifyTypedData(td.domain, td.types, td.message, normalised).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * JSON-safe form for a wallet's `eth_signTypedData_v4` (used from Phase 9): adds the
 * EIP712Domain type and writes every integer as a decimal string.
 */
export function toWalletTypedData(td: TypedData<Record<string, unknown>>) {
  const json = (v: unknown): unknown =>
    typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(json) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, json(x)])) : v;
  return {
    domain: { ...td.domain, chainId: td.domain.chainId.toString(), verifyingContract: getAddress(td.domain.verifyingContract) },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...td.types,
    },
    primaryType: td.primaryType,
    message: json(td.message) as Record<string, unknown>,
  };
}
