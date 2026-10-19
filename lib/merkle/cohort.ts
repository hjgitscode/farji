import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { AbiCoder, keccak256 } from "ethers";
import { COHORT_LEAF_V1 } from "@/lib/crypto/constants";
import { isBytes32 } from "@/lib/crypto/encoding";

// CohortProof engine (MERKLE_MODEL §2). Static batch tree for PERMANENT and EXPIRING
// credentials. Pure. Built on the audited OpenZeppelin StandardMerkleTree (pinned in
// package.json) so on-chain `MerkleProof.verify` accepts the proofs:
//
//   leaf   = keccak256(keccak256(abi.encode(COHORT_LEAF_V1, orgId, credentialId, subjectCommitment,
//                                           contentDigest, uint8 lifecycleType, uint64 validFrom,
//                                           uint64 validUntil, uint64 issuedAt, schemaId)))
//   parent = keccak256(min(a, b) ‖ max(a, b))        (sorted pairs)
//
// Leaves are SORTED BY LEAF HASH by the library, so the root depends only on the leaf SET, never
// on insertion or race order. Odd nodes use the library's complete-binary-tree layout (a lone
// node is promoted; the last node is never duplicated). Double hashing + the tag give
// second-preimage and cross-engine domain separation.

export const COHORT_LEAF_ENCODING = [
  "bytes32",
  "bytes32",
  "bytes32",
  "bytes32",
  "bytes32",
  "uint8",
  "uint64",
  "uint64",
  "uint64",
  "bytes32",
] as const;

export type CohortLeafInput = {
  orgId: string;
  credentialId: string;
  subjectCommitment: string;
  contentDigest: string;
  lifecycleType: number;
  /** Effective start of the underlying claim (unix seconds). Not the signing time. */
  validFrom: bigint;
  /** Expiry (unix seconds) for EXPIRING credentials, 0n otherwise. */
  validUntil: bigint;
  /** Actual signature timestamp (unix seconds). */
  issuedAt: bigint;
  schemaId: string;
};

type LeafValue = [string, string, string, string, string, number, bigint, bigint, bigint, string];

function toValue(l: CohortLeafInput): LeafValue {
  for (const [n, v] of [
    ["orgId", l.orgId],
    ["credentialId", l.credentialId],
    ["subjectCommitment", l.subjectCommitment],
    ["contentDigest", l.contentDigest],
    ["schemaId", l.schemaId],
  ] as const) {
    if (!isBytes32(v)) throw new Error(`${n} must be a lowercase 0x bytes32`);
  }
  if (![0, 2].includes(l.lifecycleType)) throw new Error("CohortProof holds PERMANENT (0) and EXPIRING (2) credentials only");
  return [COHORT_LEAF_V1, l.orgId, l.credentialId, l.subjectCommitment, l.contentDigest, l.lifecycleType, l.validFrom, l.validUntil, l.issuedAt, l.schemaId];
}

/** The leaf hash (double-hashed). Identical to OpenZeppelin `StandardMerkleTree.leafHash`. */
export function cohortLeafHash(l: CohortLeafInput): string {
  return keccak256(keccak256(AbiCoder.defaultAbiCoder().encode([...COHORT_LEAF_ENCODING], toValue(l))));
}

export type CohortProof = { v: 1; treeIndex: number; siblings: string[] };

export type CohortTree = {
  root: string;
  leafCount: number;
  /** One entry per input leaf, keyed by credentialId. */
  entries: { credentialId: string; leafHash: string; proof: CohortProof }[];
};

export function buildCohortTree(leaves: CohortLeafInput[]): CohortTree {
  if (leaves.length === 0) throw new Error("A cohort batch needs at least one leaf");
  const seen = new Set<string>();
  for (const l of leaves) {
    if (seen.has(l.credentialId)) throw new Error("Duplicate credentialId in cohort batch");
    seen.add(l.credentialId);
  }
  const values = leaves.map(toValue);
  const tree = StandardMerkleTree.of(values, [...COHORT_LEAF_ENCODING]);
  const hashes = new Set<string>();
  const entries = [...tree.entries()].map(([treeIndex, value]) => {
    const leafHash = tree.leafHash(value);
    if (hashes.has(leafHash)) throw new Error("Duplicate leaf hash in cohort batch");
    hashes.add(leafHash);
    return { credentialId: value[2] as string, leafHash, proof: { v: 1 as const, treeIndex, siblings: tree.getProof(treeIndex) } };
  });
  return { root: tree.root, leafCount: leaves.length, entries };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0); // lowercase equal-length hex

/** Folds a sibling path with sorted pairs and compares to `root`. Independent of the OZ library. */
export function verifyCohortProof(root: string, leafHash: string, proof: { siblings: string[] }): boolean {
  if (!isBytes32(root) || !isBytes32(leafHash)) return false;
  let h = leafHash;
  for (const sibling of proof.siblings) {
    if (!isBytes32(sibling)) return false;
    h = compare(h, sibling) <= 0 ? keccak256("0x" + h.slice(2) + sibling.slice(2)) : keccak256("0x" + sibling.slice(2) + h.slice(2));
  }
  return h === root;
}
