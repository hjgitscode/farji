import { AbiCoder, keccak256 } from "ethers";
import { keccak256Utf8 } from "@/lib/crypto/hash";
import type { AttestationType } from "@/lib/mock-data/types";

// Must match the enum declaration order in NotSoFarjiRegistry.sol exactly
// — Solidity ABI-encodes an enum as its underlying integer (uint8 here),
// so this index has to line up with the contract's COHORT/PROOF_PULSE order.
const ATTESTATION_TYPE_INDEX: Record<AttestationType, number> = {
  COHORT: 0,
  PROOF_PULSE: 1,
};

export const GENESIS_CHAIN_ROOT = `0x${"0".repeat(64)}`;

/**
 * Off-chain equivalent of the contract's chain-continuity formula:
 * `keccak256(abi.encode(batchRoot, previousChainRoot, organisationId,
 * attestationType, epoch))`. Computing it here — with the exact same ABI
 * types the contract uses — lets the UI show a real chain root before
 * anything is anchored, and lets a verifier recompute the same value the
 * contract would have stored, from public inputs.
 */
export function computeChainRoot(params: {
  batchRoot: string;
  previousChainRoot: string;
  organisationId: string;
  attestationType: AttestationType;
  epoch: number;
}): string {
  const organisationIdBytes32 = keccak256Utf8(params.organisationId);

  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32", "bytes32", "uint8", "uint64"],
      [
        params.batchRoot,
        params.previousChainRoot,
        organisationIdBytes32,
        ATTESTATION_TYPE_INDEX[params.attestationType],
        params.epoch,
      ],
    ),
  );
}
