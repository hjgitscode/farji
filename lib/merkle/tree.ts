import { hashPair } from "./hashPair";

/**
 * Builds every layer of the tree, bottom-up, from a layer of pre-hashed
 * bytes32 leaves. When a layer has an odd node out, it carries up to the
 * next layer unchanged rather than being paired with a duplicate of
 * itself — the classic "duplicate the last leaf" trick has a known
 * subtle vulnerability (a forged proof for a duplicated node), and
 * carrying up avoids it while staying just as easy to explain.
 */
function buildLayers(leaves: string[]): string[][] {
  if (leaves.length === 0) {
    throw new Error("Cannot build a Merkle tree with zero leaves");
  }

  const layers: string[][] = [leaves];
  let current = leaves;

  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = current[i + 1];
      next.push(right === undefined ? left : hashPair(left, right));
    }
    layers.push(next);
    current = next;
  }

  return layers;
}

/**
 * Reads off the sibling hash at each level on the path from a leaf up to
 * the root. A level where the leaf's ancestor was carried up unchanged
 * (see buildLayers) contributes no entry — there's nothing to combine
 * with at that level, and skipping it is exactly what keeps
 * verifyProof correct for odd-sized layers.
 */
function computeProof(layers: string[][], leafIndex: number): string[] {
  const proof: string[] = [];
  let index = leafIndex;

  for (let level = 0; level < layers.length - 1; level += 1) {
    const layer = layers[level];
    const isRightNode = index % 2 === 1;
    const siblingIndex = isRightNode ? index - 1 : index + 1;

    if (siblingIndex < layer.length) {
      proof.push(layer[siblingIndex]);
    }

    index = Math.floor(index / 2);
  }

  return proof;
}

/** Recomputes the root from a leaf and its proof, and compares it to `root`. */
export function verifyProof(leaf: string, proof: string[], root: string): boolean {
  const computedRoot = proof.reduce((computed, sibling) => hashPair(computed, sibling), leaf);
  return computedRoot === root;
}

/**
 * A Merkle tree over pre-hashed bytes32 leaves (batch members are hashed
 * with lib/crypto before being handed to this class — the tree engine
 * itself never hashes raw credential data, only combines already-hashed
 * leaves). Used by both CohortProof and ProofPulse batch creation.
 */
export class MerkleTree {
  readonly leaves: string[];
  private readonly layers: string[][];
  readonly root: string;

  constructor(leaves: string[]) {
    this.leaves = leaves;
    this.layers = buildLayers(leaves);
    this.root = this.layers[this.layers.length - 1][0];
  }

  /** The sibling-hash proof for the leaf at `leafIndex`. */
  getProof(leafIndex: number): string[] {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} is out of range for a tree of ${this.leaves.length} leaves`);
    }
    return computeProof(this.layers, leafIndex);
  }

  static verify(leaf: string, proof: string[], root: string): boolean {
    return verifyProof(leaf, proof, root);
  }
}
