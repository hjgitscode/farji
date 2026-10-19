import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { AbiCoder, concat, keccak256 } from "ethers";
import { describe, expect, it } from "vitest";
import * as K from "@/lib/crypto/constants";
import { buildCohortTree, COHORT_LEAF_ENCODING, cohortLeafHash, verifyCohortProof, type CohortLeafInput } from "@/lib/merkle/cohort";
import vectors from "../vectors/crypto.json";
import { rep, V } from "../vectors/inputs";

const hex = (n: number) => n.toString(16).padStart(2, "0");

/** n distinct leaves; credentialId is unique per leaf. */
const leaves = (n: number, offset = 0): CohortLeafInput[] =>
  Array.from({ length: n }, (_, i) => ({
    orgId: V.orgId,
    credentialId: "0x" + (i + 1 + offset).toString(16).padStart(64, "0"),
    subjectCommitment: rep(hex((i % 200) + 1)),
    contentDigest: rep(hex(((i * 7) % 200) + 1)),
    lifecycleType: i % 2 === 0 ? K.LIFECYCLE_CODE.PERMANENT : K.LIFECYCLE_CODE.EXPIRING,
    validFrom: V.validFrom,
    validUntil: i % 2 === 0 ? 0n : 1900000000n,
    issuedAt: V.issuedAt + BigInt(i),
    schemaId: K.SCHEMA_ID,
  }));

const toValue = (l: CohortLeafInput) => [K.COHORT_LEAF_V1, l.orgId, l.credentialId, l.subjectCommitment, l.contentDigest, l.lifecycleType, l.validFrom, l.validUntil, l.issuedAt, l.schemaId];

/** Deterministic Fisher–Yates with a seeded PRNG. */
function shuffled<T>(items: T[], seed: number): T[] {
  const a = [...items];
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe("cohort leaf", () => {
  it("is the double-hashed, tagged abi.encode of the ten fields", () => {
    const l = leaves(1)[0];
    const encoded = AbiCoder.defaultAbiCoder().encode([...COHORT_LEAF_ENCODING], toValue(l));
    expect(cohortLeafHash(l)).toBe(keccak256(keccak256(encoded)));
    // Hand-built: tag ‖ orgId ‖ credentialId ‖ subject ‖ content ‖ pad(lifecycle) ‖ pad(from) ‖ pad(until) ‖ pad(issued) ‖ schemaId
    const pad = (n: bigint | number) => "0x" + BigInt(n).toString(16).padStart(64, "0");
    const manual = concat([K.COHORT_LEAF_V1, l.orgId, l.credentialId, l.subjectCommitment, l.contentDigest, pad(l.lifecycleType), pad(l.validFrom), pad(l.validUntil), pad(l.issuedAt), l.schemaId]);
    expect(keccak256(keccak256(manual))).toBe(cohortLeafHash(l));
  });

  it("matches OpenZeppelin StandardMerkleTree's leaf hash", () => {
    const l = leaves(1)[0];
    expect(cohortLeafHash(l)).toBe(StandardMerkleTree.of([toValue(l)], [...COHORT_LEAF_ENCODING]).leafHash(toValue(l)));
  });

  it("changes when any field changes", () => {
    const l = leaves(1)[0];
    const base = cohortLeafHash(l);
    for (const change of [
      { orgId: rep("12") },
      { credentialId: rep("99") },
      { subjectCommitment: rep("98") },
      { contentDigest: rep("97") },
      { lifecycleType: K.LIFECYCLE_CODE.EXPIRING },
      { validFrom: l.validFrom + 1n },
      { validUntil: 5n },
      { issuedAt: l.issuedAt + 1n },
      { schemaId: rep("96") },
    ]) {
      expect(cohortLeafHash({ ...l, ...change })).not.toBe(base);
    }
  });

  it("rejects CONTINUING credentials and malformed fields", () => {
    const l = leaves(1)[0];
    expect(() => cohortLeafHash({ ...l, lifecycleType: K.LIFECYCLE_CODE.CONTINUING })).toThrow(/PERMANENT/);
    expect(() => cohortLeafHash({ ...l, orgId: "0x12" })).toThrow();
  });

  it("is domain separated: the leaf preimage is 320 bytes, an internal node's is 64", () => {
    const l = leaves(1)[0];
    expect((AbiCoder.defaultAbiCoder().encode([...COHORT_LEAF_ENCODING], toValue(l)).length - 2) / 2).toBe(320);
    expect(K.COHORT_LEAF_V1).not.toBe(K.PULSE_LEAF_V1);
  });
});

describe("deterministic root and ordering", () => {
  it("is independent of insertion order", () => {
    const set = leaves(9);
    const root = buildCohortTree(set).root;
    for (const seed of [1, 2, 3, 4, 5]) expect(buildCohortTree(shuffled(set, seed)).root).toBe(root);
  });

  it("is reproducible and equals OpenZeppelin's own root for the same leaves", () => {
    const set = leaves(6);
    const ours = buildCohortTree(set);
    expect(buildCohortTree(set).root).toBe(ours.root);
    expect(StandardMerkleTree.of(set.map(toValue), [...COHORT_LEAF_ENCODING]).root).toBe(ours.root);
  });

  it("a different leaf set gives a different root", () => {
    expect(buildCohortTree(leaves(4)).root).not.toBe(buildCohortTree(leaves(4, 100)).root);
    expect(buildCohortTree(leaves(4)).root).not.toBe(buildCohortTree(leaves(5)).root);
  });

  it("matches the committed golden vector", () => {
    const three = ["01", "02", "03"].map((b) => ({
      orgId: V.orgId,
      credentialId: rep(b),
      subjectCommitment: vectors.subjectCommitment,
      contentDigest: vectors.contentDigest,
      lifecycleType: K.LIFECYCLE_CODE.PERMANENT,
      validFrom: V.validFrom,
      validUntil: V.validUntil,
      issuedAt: V.issuedAt,
      schemaId: K.SCHEMA_ID,
    }));
    const tree = buildCohortTree(three);
    expect(tree.root).toBe(vectors.cohort.root);
    expect(three.map(cohortLeafHash)).toEqual(vectors.cohort.leafHashes);
    expect(tree.entries).toEqual(vectors.cohort.entries);
  });
});

describe("proofs", () => {
  for (const n of [1, 2, 3, 5, 100]) {
    it(`every proof verifies for ${n} leaf${n === 1 ? "" : "s"} (ours and OpenZeppelin's verifier)`, () => {
      const set = leaves(n);
      const tree = buildCohortTree(set);
      expect(tree.leafCount).toBe(n);
      expect(tree.entries).toHaveLength(n);
      for (const [i, entry] of tree.entries.entries()) {
        expect(verifyCohortProof(tree.root, entry.leafHash, entry.proof)).toBe(true);
        if (n <= 5 || i % 17 === 0) {
          const input = set.find((l) => l.credentialId === entry.credentialId)!;
          expect(StandardMerkleTree.verify(tree.root, [...COHORT_LEAF_ENCODING], toValue(input), entry.proof.siblings)).toBe(true);
        }
      }
      if (n === 1) {
        expect(tree.entries[0].proof.siblings).toEqual([]);
        expect(tree.root).toBe(tree.entries[0].leafHash);
      }
    });
  }

  it("rejects a tampered sibling, a wrong leaf, a wrong root and a proof for another leaf", () => {
    const tree = buildCohortTree(leaves(5));
    const [a, b] = tree.entries;
    const flipped = a.proof.siblings.map((s, i) => (i === 0 ? "0x" + (s[2] === "0" ? "1" : "0") + s.slice(3) : s));
    expect(verifyCohortProof(tree.root, a.leafHash, { siblings: flipped })).toBe(false);
    expect(verifyCohortProof(tree.root, rep("ee"), a.proof)).toBe(false);
    expect(verifyCohortProof(rep("ee"), a.leafHash, a.proof)).toBe(false);
    expect(verifyCohortProof(tree.root, b.leafHash, a.proof)).toBe(false);
    expect(verifyCohortProof(tree.root, a.leafHash, { siblings: a.proof.siblings.slice(0, -1) })).toBe(false);
    expect(verifyCohortProof(tree.root, a.leafHash, { siblings: [...a.proof.siblings, rep("01")] })).toBe(false);
    expect(verifyCohortProof(tree.root, a.leafHash, { siblings: ["0x12"] })).toBe(false);
  });

  it("a proof is not valid against a different batch's root", () => {
    const one = buildCohortTree(leaves(4));
    const two = buildCohortTree(leaves(4, 50));
    expect(verifyCohortProof(two.root, one.entries[0].leafHash, one.entries[0].proof)).toBe(false);
  });
});

describe("batch validity", () => {
  it("refuses to build an empty batch", () => {
    expect(() => buildCohortTree([])).toThrow(/at least one/);
  });

  it("refuses duplicate credentials", () => {
    const [a] = leaves(1);
    expect(() => buildCohortTree([a, { ...a }])).toThrow(/Duplicate/);
  });

  it("a supplementary batch is a separate tree: the old batch's root and proofs never change", () => {
    const first = leaves(3);
    const sealed = buildCohortTree(first);
    const supplementary = buildCohortTree(leaves(1, 10));
    // The sealed batch is rebuilt identically afterwards; the late entrant has its own root.
    expect(buildCohortTree(first).root).toBe(sealed.root);
    expect(supplementary.root).not.toBe(sealed.root);
    for (const entry of sealed.entries) expect(verifyCohortProof(sealed.root, entry.leafHash, entry.proof)).toBe(true);
    // The late entrant's leaf is NOT provable against the sealed root.
    expect(verifyCohortProof(sealed.root, supplementary.entries[0].leafHash, supplementary.entries[0].proof)).toBe(false);
  });
});
