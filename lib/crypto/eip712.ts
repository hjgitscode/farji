import { verifyTypedData, type Signer, type TypedDataField } from "ethers";
import { keccak256Utf8 } from "./hash";

export const EIP712_DOMAIN_NAME = "NotSoFarji";
export const EIP712_DOMAIN_VERSION = "1";

/** Hardhat's default local chain id. Real Sepolia/Amoy ids apply in Review 3. */
export const LOCAL_CHAIN_ID = 31337;

/** Placeholder until the contract exists (Phase 6) and gets a real deployed address. */
export const PLACEHOLDER_VERIFYING_CONTRACT = "0x0000000000000000000000000000000000000000";

export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export function buildDomain(overrides: Partial<EIP712Domain> = {}): EIP712Domain {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: LOCAL_CHAIN_ID,
    verifyingContract: PLACEHOLDER_VERIFYING_CONTRACT,
    ...overrides,
  };
}

/**
 * The EIP-712 struct an issuer signs for one credential attestation.
 * credentialId and organisationId are declared bytes32 (not string)
 * because the contract stores and compares both as fixed-size opaque
 * keys — see lib/mock-data's `mapping(bytes32 => Organisation)` design
 * in docs/ARCHITECTURE.md section 6.
 */
export const CREDENTIAL_ATTESTATION_TYPES: Record<string, TypedDataField[]> = {
  CredentialAttestation: [
    { name: "credentialId", type: "bytes32" },
    { name: "claimHash", type: "bytes32" },
    { name: "organisationId", type: "bytes32" },
    { name: "version", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "timestamp", type: "uint64" },
  ],
};

export interface CredentialAttestationMessage {
  credentialId: string; // bytes32 hex
  claimHash: string; // bytes32 hex
  organisationId: string; // bytes32 hex
  version: number;
  nonce: number;
  timestamp: number;
}

/**
 * Builds the exact message an issuer signs. `credentialId` and
 * `organisationId` arrive as their normal short string ids (e.g.
 * "CRED-001") and get hashed down to bytes32 here — the same reasoning
 * as claim hashing: arbitrary-length string identifiers are hashed to a
 * fixed size before anything touches the contract or a signature.
 */
export function buildCredentialAttestationMessage(params: {
  credentialId: string;
  claimHash: string;
  organisationId: string;
  version: number;
  nonce: number;
  timestamp: number;
}): CredentialAttestationMessage {
  return {
    credentialId: keccak256Utf8(params.credentialId),
    claimHash: params.claimHash,
    organisationId: keccak256Utf8(params.organisationId),
    version: params.version,
    nonce: params.nonce,
    timestamp: params.timestamp,
  };
}

/** Has `signer` produce an EIP-712 signature over `message` bound to `domain`. */
export function signCredentialAttestation(
  signer: Signer,
  message: CredentialAttestationMessage,
  domain: EIP712Domain = buildDomain(),
): Promise<string> {
  return signer.signTypedData(domain, CREDENTIAL_ATTESTATION_TYPES, message);
}

/**
 * Recovers the address that produced `signature` over `message` and
 * `domain`. ECDSA recovery always returns *an* address — it never
 * "fails" outright — so a tampered message or wrong domain doesn't throw,
 * it silently recovers the WRONG address. Verifying is therefore always
 * "does the recovered address equal the issuer wallet I trust?", done by
 * the caller (e.g. lib/services/issuerService's isIssuerValidAt).
 */
export function recoverCredentialAttestationSigner(
  message: CredentialAttestationMessage,
  signature: string,
  domain: EIP712Domain = buildDomain(),
): string {
  return verifyTypedData(domain, CREDENTIAL_ATTESTATION_TYPES, message, signature);
}
