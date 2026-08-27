import { describe, expect, it } from "vitest";
import { keccak256Utf8 } from "@/lib/crypto/hash";
import { hashPair } from "@/lib/merkle/hashPair";
import { MerkleTree, verifyProof } from "@/lib/merkle/tree";

const leaf = (label: string) => keccak256Utf8(label);

describe("hashPair", () => {
  it("is order-independent (sorts the pair before hashing)", () => {
    const a = leaf("a");
    const b = leaf("b");
    expect(hashPair(a, b)).toBe(hashPair(b, a));
  });

  it("is deterministic", () => {
    const a = leaf("a");
    const b = leaf("b");
    expect(hashPair(a, b)).toBe(hashPair(a, b));
  });

  it("produces a 32-byte hex value", () => {
    expect(hashPair(leaf("a"), leaf("b"))).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("MerkleTree", () => {
  it("a single-leaf tree's root is the leaf itself", () => {
    const tree = new MerkleTree([leaf("only")]);
    expect(tree.root).toBe(leaf("only"));
  });

  it("builds a consistent root for four leaves", () => {
    const leaves = ["a", "b", "c", "d"].map(leaf);
    const tree = new MerkleTree(leaves);
    expect(tree.root).toMatch(/^0x[0-9a-f]{64}$/);

    // The root only depends on the leaf set, not on re-construction.
    const rebuilt = new MerkleTree(leaves);
    expect(rebuilt.root).toBe(tree.root);
  });

  it("produces a valid proof for every leaf in a 4-leaf tree", () => {
    const leaves = ["a", "b", "c", "d"].map(leaf);
    const tree = new MerkleTree(leaves);

    leaves.forEach((leafHash, index) => {
      const proof = tree.getProof(index);
      expect(verifyProof(leafHash, proof, tree.root)).toBe(true);
    });
  });

  it("handles an odd number of leaves (carry-up case)", () => {
    const leaves = ["a", "b", "c"].map(leaf);
    const tree = new MerkleTree(leaves);

    leaves.forEach((leafHash, index) => {
      const proof = tree.getProof(index);
      expect(verifyProof(leafHash, proof, tree.root)).toBe(true);
    });
  });

  it("handles a larger, non-power-of-two batch (5 leaves)", () => {
    const leaves = ["a", "b", "c", "d", "e"].map(leaf);
    const tree = new MerkleTree(leaves);

    leaves.forEach((leafHash, index) => {
      const proof = tree.getProof(index);
      expect(verifyProof(leafHash, proof, tree.root)).toBe(true);
    });
  });

  it("rejects a proof for the wrong leaf", () => {
    const leaves = ["a", "b", "c", "d"].map(leaf);
    const tree = new MerkleTree(leaves);
    const proofForA = tree.getProof(0);

    expect(verifyProof(leaf("b"), proofForA, tree.root)).toBe(false);
  });

  it("rejects a proof against a tampered root", () => {
    const leaves = ["a", "b", "c", "d"].map(leaf);
    const tree = new MerkleTree(leaves);
    const proof = tree.getProof(0);
    const tamperedRoot = leaf("not-the-real-root");

    expect(verifyProof(leaves[0], proof, tamperedRoot)).toBe(false);
  });

  it("rejects a proof with a tampered sibling hash", () => {
    const leaves = ["a", "b", "c", "d"].map(leaf);
    const tree = new MerkleTree(leaves);
    const proof = tree.getProof(0);
    const tamperedProof = [leaf("wrong-sibling"), ...proof.slice(1)];

    expect(verifyProof(leaves[0], tamperedProof, tree.root)).toBe(false);
  });

  it("throws for an out-of-range leaf index", () => {
    const tree = new MerkleTree(["a", "b"].map(leaf));
    expect(() => tree.getProof(5)).toThrow();
    expect(() => tree.getProof(-1)).toThrow();
  });

  it("throws when constructed with zero leaves", () => {
    expect(() => new MerkleTree([])).toThrow();
  });
});
