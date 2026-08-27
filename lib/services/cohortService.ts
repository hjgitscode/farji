import { cohortStudents, COHORT_ATTESTATION_LABEL, COHORT_ANCHORED_AT, type CohortLeaf } from "@/lib/mock-data/cohortDemo";
import { hashCredential } from "@/lib/crypto/hash";
import { MerkleTree, computeChainRoot, GENESIS_CHAIN_ROOT } from "@/lib/merkle";

export interface CohortBatch {
  leaves: CohortLeaf[];
  leafHashes: string[];
  tree: MerkleTree;
  root: string;
  chainRoot: string;
  label: string;
  anchoredAt: string;
  epoch: number;
}

/** Builds the real Merkle tree for the 2026 graduation cohort demo. */
export function buildCohortBatch(): CohortBatch {
  const leafHashes = cohortStudents.map((student) => hashCredential(student.claim));
  const tree = new MerkleTree(leafHashes);
  const chainRoot = computeChainRoot({
    batchRoot: tree.root,
    previousChainRoot: GENESIS_CHAIN_ROOT,
    organisationId: "ORG-IITD",
    attestationType: "COHORT",
    epoch: 1,
  });

  return {
    leaves: cohortStudents,
    leafHashes,
    tree,
    root: tree.root,
    chainRoot,
    label: COHORT_ATTESTATION_LABEL,
    anchoredAt: COHORT_ANCHORED_AT,
    epoch: 1,
  };
}

export interface StudentProof {
  leaf: CohortLeaf;
  leafHash: string;
  proof: string[];
  valid: boolean;
  root: string;
}

/** A specific student's real Merkle inclusion proof against the cohort root. */
export function getStudentProof(studentId: string): StudentProof | undefined {
  const batch = buildCohortBatch();
  const index = batch.leaves.findIndex((student) => student.id === studentId);
  if (index === -1) return undefined;

  const leafHash = batch.leafHashes[index];
  const proof = batch.tree.getProof(index);

  return {
    leaf: batch.leaves[index],
    leafHash,
    proof,
    valid: MerkleTree.verify(leafHash, proof, batch.root),
    root: batch.root,
  };
}
