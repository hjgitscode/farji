import { AbiCoder, keccak256 } from "ethers";
import { ATTESTATION_TYPE_CODE, type AttestationTypeName } from "./constants";
import { isBytes32 } from "./encoding";

// Conceptual attestation-chain commitment (ARCHITECTURE AD-11, BLOCKCHAIN_MODEL §8.1):
//
//   chainRoot = keccak256(abi.encode(bytes32 batchRoot, bytes32 previousChainRoot,
//                                    bytes32 orgId, uint8 attestationType, uint64 epoch))
//
// Phase 8 Solidity must reproduce the committed golden vector (or both sides change together).
// COHORT and PROOF_PULSE are separate chains per Organisation; `epoch` starts at 1.

const abi = AbiCoder.defaultAbiCoder();

export function chainRootOf(
  batchRoot: string,
  previousChainRoot: string,
  orgId: string,
  attestationType: AttestationTypeName,
  epoch: bigint,
): string {
  for (const [name, v] of [["batchRoot", batchRoot], ["previousChainRoot", previousChainRoot], ["orgId", orgId]] as const) {
    if (!isBytes32(v)) throw new Error(`${name} must be a lowercase 0x bytes32`);
  }
  if (epoch < 1n) throw new Error("epoch starts at 1");
  return keccak256(
    abi.encode(
      ["bytes32", "bytes32", "bytes32", "uint8", "uint64"],
      [batchRoot, previousChainRoot, orgId, ATTESTATION_TYPE_CODE[attestationType], epoch],
    ),
  );
}
