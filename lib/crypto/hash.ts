import { keccak256, toUtf8Bytes } from "ethers";
import { canonicaliseCredential, canonicalCredentialToString } from "./canonicalise";
import type { CanonicalCredential, CanonicalCredentialInput } from "./types";

/**
 * Ethereum's `keccak256` — used here via ethers.js, the same library the
 * contract tests and deploy scripts use, and NOT the same algorithm as
 * NIST SHA3-256 (they differ in padding). This is deliberate: the EVM's
 * `keccak256` opcode and Solidity's `keccak256()` both use the original
 * Keccak, so hashing this way keeps Phase 6+ contract checks consistent
 * with whatever gets hashed here off-chain.
 */
export function keccak256Utf8(value: string): string {
  return keccak256(toUtf8Bytes(value));
}

/**
 * The claim hash: Keccak-256 over the exact UTF-8 bytes of the canonical
 * JSON string. The contract never needs to re-derive this from a
 * credential's fields — it only ever stores or compares this bytes32
 * value as an opaque fingerprint, so hashing the canonical string
 * directly (rather than ABI-encoding each field) keeps both the hashing
 * code and the contract simple.
 */
export function hashCanonicalCredential(credential: CanonicalCredential): string {
  return keccak256Utf8(canonicalCredentialToString(credential));
}

/** Convenience wrapper: canonicalise then hash in one call. */
export function hashCredential(input: CanonicalCredentialInput): string {
  return hashCanonicalCredential(canonicaliseCredential(input));
}
