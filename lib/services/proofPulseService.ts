import {
  augustLeaves,
  septemberLeaves,
  AUGUST_ATTESTATION_LABEL,
  AUGUST_ANCHORED_AT,
  SEPTEMBER_ATTESTATION_LABEL,
  SEPTEMBER_ANCHORED_AT,
  type ProofPulseLeaf,
} from "@/lib/mock-data/proofPulseDemo";
import { hashCredential } from "@/lib/crypto/hash";
import { MerkleTree, computeChainRoot, GENESIS_CHAIN_ROOT } from "@/lib/merkle";

export interface ProofPulseEpochBatch {
  leaves: ProofPulseLeaf[];
  tree: MerkleTree;
  root: string;
  chainRoot: string;
  previousChainRoot: string;
  label: string;
  anchoredAt: string;
  epoch: number;
}

/**
 * Builds both real Merkle batches for the ProofPulse walkthrough,
 * chained together exactly as the contract would: September's chain
 * root is computed from August's, not from genesis.
 */
export function buildProofPulseBatches(): { august: ProofPulseEpochBatch; september: ProofPulseEpochBatch } {
  const augustHashes = augustLeaves.map((leaf) => hashCredential(leaf.claim));
  const augustTree = new MerkleTree(augustHashes);
  const augustChainRoot = computeChainRoot({
    batchRoot: augustTree.root,
    previousChainRoot: GENESIS_CHAIN_ROOT,
    organisationId: "ORG-XYZ",
    attestationType: "PROOF_PULSE",
    epoch: 1,
  });

  const septemberHashes = septemberLeaves.map((leaf) => hashCredential(leaf.claim));
  const septemberTree = new MerkleTree(septemberHashes);
  const septemberChainRoot = computeChainRoot({
    batchRoot: septemberTree.root,
    previousChainRoot: augustChainRoot,
    organisationId: "ORG-XYZ",
    attestationType: "PROOF_PULSE",
    epoch: 2,
  });

  return {
    august: {
      leaves: augustLeaves,
      tree: augustTree,
      root: augustTree.root,
      chainRoot: augustChainRoot,
      previousChainRoot: GENESIS_CHAIN_ROOT,
      label: AUGUST_ATTESTATION_LABEL,
      anchoredAt: AUGUST_ANCHORED_AT,
      epoch: 1,
    },
    september: {
      leaves: septemberLeaves,
      tree: septemberTree,
      root: septemberTree.root,
      chainRoot: septemberChainRoot,
      previousChainRoot: augustChainRoot,
      label: SEPTEMBER_ATTESTATION_LABEL,
      anchoredAt: SEPTEMBER_ANCHORED_AT,
      epoch: 2,
    },
  };
}
