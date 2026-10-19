import { concat, getBytes, keccak256 } from "ethers";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as K from "@/lib/crypto/constants";
import {
  computePathUpdate,
  emptyPulseRoot,
  pulseCapacity,
  pulseLeafHash,
  pulseNodeHash,
  pulseScopeFor,
  replayPulseLog,
  siblingCoordinates,
  SparsePulseTree,
  verifyPulseProof,
  zeroHashes,
  type PulseLeafInput,
  type PulseLogEntry,
} from "@/lib/merkle/pulse";
import vectors from "../vectors/crypto.json";
import { rep, V } from "../vectors/inputs";
import { mulberry32, referencePulseRoot } from "./reference";

afterEach(() => vi.useRealTimers());

const leafOf = (leafIndex: number, over: Partial<PulseLeafInput> = {}): PulseLeafInput => ({
  orgId: V.orgId,
  leafIndex,
  credentialId: "0x" + (leafIndex + 1).toString(16).padStart(64, "0"),
  subjectCommitment: rep("5a"),
  contentDigest: rep("5b"),
  scope: K.SCOPE_CODE.EMPLOYMENT,
  status: K.PULSE_STATUS_CODE.ACTIVE,
  statusEffectiveAt: V.validFrom,
  statusSeq: 1,
  ...over,
});

describe("zero hashes and the empty tree", () => {
  it("zero[0] = keccak256(PULSE_EMPTY_V1) and zero[i+1] = node(zero[i], zero[i])", () => {
    const z = zeroHashes(5);
    expect(z).toHaveLength(6);
    expect(z[0]).toBe(keccak256(getBytes(K.PULSE_EMPTY_V1)));
    for (let i = 0; i < 5; i++) {
      expect(z[i + 1]).toBe(keccak256(concat([K.PULSE_NODE_V1, z[i], z[i]])));
    }
    expect(emptyPulseRoot(5)).toBe(z[5]);
  });

  it("matches the committed golden vector", () => {
    expect(zeroHashes(vectors.pulse.depth)).toEqual(vectors.pulse.zeroHashes);
    expect(emptyPulseRoot(vectors.pulse.depth)).toBe(vectors.pulse.emptyRoot);
    expect(pulseNodeHash(vectors.pulse.zeroHashes[0], vectors.pulse.zeroHashes[0])).toBe(vectors.pulse.nodeOfZeros);
  });

  it("a fresh sparse tree has the zero root and a zero-sibling proof for any index", () => {
    const t = new SparsePulseTree(4);
    expect(t.root).toBe(emptyPulseRoot(4));
    expect(t.proof(7)).toEqual(zeroHashes(4).slice(0, 4));
  });

  it("depth is bounded", () => {
    expect(() => zeroHashes(0)).toThrow();
    expect(() => zeroHashes(33)).toThrow();
    expect(pulseCapacity(20)).toBe(1048576);
  });
});

describe("leaf hash", () => {
  it("is the double-hashed, tagged abi.encode of the ten fields (hand-built)", () => {
    const l = leafOf(3);
    const pad = (n: bigint | number) => "0x" + BigInt(n).toString(16).padStart(64, "0");
    const preimage = concat([K.PULSE_LEAF_V1, l.orgId, pad(l.leafIndex), l.credentialId, l.subjectCommitment, l.contentDigest, pad(l.scope), pad(l.status), pad(l.statusEffectiveAt), pad(l.statusSeq)]);
    expect(pulseLeafHash(l)).toBe(keccak256(keccak256(preimage)));
  });

  it("matches the committed golden vectors for ACTIVE and ENDED", () => {
    const common = { subjectCommitment: vectors.subjectCommitment, contentDigest: vectors.contentDigest };
    expect(pulseLeafHash(leafOf(0, { ...common, credentialId: rep("a1") }))).toBe(vectors.pulse.leafA);
    expect(pulseLeafHash(leafOf(0, { ...common, credentialId: rep("a1"), status: 1, statusEffectiveAt: V.effectiveAt, statusSeq: 2 }))).toBe(vectors.pulse.leafAEnded);
  });

  it("ACTIVE and ENDED hash differently, as do index, scope and statusSeq", () => {
    const active = pulseLeafHash(leafOf(0));
    expect(pulseLeafHash(leafOf(0, { status: 1 }))).not.toBe(active);
    expect(pulseLeafHash(leafOf(1, { credentialId: leafOf(0).credentialId }))).not.toBe(active);
    expect(pulseLeafHash(leafOf(0, { scope: K.SCOPE_CODE.MEMBERSHIP }))).not.toBe(active);
    expect(pulseLeafHash(leafOf(0, { statusSeq: 2 }))).not.toBe(active);
    expect(pulseLeafHash(leafOf(0, { statusEffectiveAt: V.validFrom + 1n }))).not.toBe(active);
  });

  it("rejects malformed fields", () => {
    expect(() => pulseLeafHash(leafOf(0, { statusSeq: 0 }))).toThrow();
    expect(() => pulseLeafHash(leafOf(0, { status: 2 }))).toThrow();
    expect(() => pulseLeafHash(leafOf(-1))).toThrow();
    expect(() => pulseLeafHash(leafOf(0, { orgId: "0x12" }))).toThrow();
  });

  it("is domain separated from CohortProof leaves", () => {
    expect(K.PULSE_LEAF_V1).not.toBe(K.COHORT_LEAF_V1);
    expect(K.PULSE_NODE_V1).not.toBe(K.PULSE_LEAF_V1);
  });

  it("maps categories to scopes", () => {
    expect(pulseScopeFor("EXPERIENCE")).toBe("EMPLOYMENT");
    expect(pulseScopeFor("EDUCATION")).toBe("ENROLMENT");
    expect(pulseScopeFor("MEMBERSHIP")).toBe("MEMBERSHIP");
    expect(pulseScopeFor("CERTIFICATION")).toBe("MEMBERSHIP");
    expect(() => pulseScopeFor("OTHER")).toThrow();
  });
});

describe("insertion, stable indices and ACTIVE -> ENDED", () => {
  it("matches the committed golden roots (insert 0, insert 1, end 0)", () => {
    const common = { subjectCommitment: vectors.subjectCommitment, contentDigest: vectors.contentDigest };
    const t = new SparsePulseTree(3);
    const a = pulseLeafHash(leafOf(0, { ...common, credentialId: rep("a1") }));
    const b = pulseLeafHash(leafOf(1, { ...common, credentialId: rep("b2") }));
    const ended = pulseLeafHash(leafOf(0, { ...common, credentialId: rep("a1"), status: 1, statusEffectiveAt: V.effectiveAt, statusSeq: 2 }));
    expect(t.setLeaf(0, a)).toBe(vectors.pulse.rootAfterA);
    expect(t.setLeaf(1, b)).toBe(vectors.pulse.rootAfterB);
    expect(t.setLeaf(0, ended)).toBe(vectors.pulse.rootAfterEnd);
    expect(t.proof(1)).toEqual(vectors.pulse.proofOfB);
  });

  it("the first leaf takes index 0, the second index 1, and an ended leaf keeps its index", () => {
    const t = new SparsePulseTree(4);
    const r0 = t.root;
    const r1 = t.setLeaf(0, pulseLeafHash(leafOf(0)));
    const r2 = t.setLeaf(1, pulseLeafHash(leafOf(1)));
    const r3 = t.setLeaf(0, pulseLeafHash(leafOf(0, { status: 1, statusSeq: 2 }))); // same index, now ENDED
    expect(new Set([r0, r1, r2, r3]).size).toBe(4);
    // Leaf 0 still proves (as ENDED) at index 0 against the newest root.
    expect(verifyPulseProof(t.root, 4, 0, pulseLeafHash(leafOf(0, { status: 1, statusSeq: 2 })), t.proof(0))).toBe(true);
    // ...and the old ACTIVE leaf no longer proves at that index.
    expect(verifyPulseProof(t.root, 4, 0, pulseLeafHash(leafOf(0)), t.proof(0))).toBe(false);
  });

  it("a state change recomputes exactly the leaf and its `depth` ancestors", () => {
    const depth = 6;
    const t = new SparsePulseTree(depth);
    for (let i = 0; i < 5; i++) t.setLeaf(i, pulseLeafHash(leafOf(i)));
    const { nodes } = computePathUpdate(depth, 2, pulseLeafHash(leafOf(2, { status: 1, statusSeq: 2 })), t.lookup);
    expect(nodes).toHaveLength(depth + 1);
    expect(nodes.map((n) => n.level)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(nodes.map((n) => n.position)).toEqual([2, 1, 0, 0, 0, 0, 0]);
  });

  it("only the path changes: untouched leaves keep their values and their proofs differ in exactly one sibling", () => {
    const depth = 6;
    const t = new SparsePulseTree(depth);
    const hashes = Array.from({ length: 9 }, (_, i) => pulseLeafHash(leafOf(i)));
    hashes.forEach((h, i) => t.setLeaf(i, h));
    const before = hashes.map((_, i) => t.proof(i));
    const levelZeroBefore = hashes.map((_, i) => t.lookup(0, i));

    t.setLeaf(3, pulseLeafHash(leafOf(3, { status: 1, statusSeq: 2 })));

    for (let i = 0; i < 9; i++) {
      if (i === 3) continue;
      expect(t.lookup(0, i)).toBe(levelZeroBefore[i]); // leaf value untouched
      const after = t.proof(i);
      const changed = after.filter((s, level) => s !== before[i][level]).length;
      expect(changed, `leaf ${i}`).toBe(1); // exactly the sibling on the updated path
      expect(verifyPulseProof(t.root, depth, i, hashes[i], after)).toBe(true);
    }
  });

  it("performs no hashing outside the path: a single update computes exactly `depth` node hashes", () => {
    // Nodes returned = leaf + depth ancestors; the leaf itself is not re-hashed here.
    const depth = 8;
    const t = new SparsePulseTree(depth);
    const { nodes } = computePathUpdate(depth, 5, pulseLeafHash(leafOf(5)), t.lookup);
    expect(nodes.length - 1).toBe(depth);
  });
});

describe("proofs", () => {
  it("a current proof verifies; a tampered proof, leaf, index, root or length does not", () => {
    const depth = 5;
    const t = new SparsePulseTree(depth);
    const hashes = [0, 1, 2].map((i) => pulseLeafHash(leafOf(i)));
    hashes.forEach((h, i) => t.setLeaf(i, h));
    const proof = t.proof(2);
    expect(verifyPulseProof(t.root, depth, 2, hashes[2], proof)).toBe(true);
    expect(verifyPulseProof(t.root, depth, 2, hashes[2], proof.map((s, i) => (i === 1 ? rep("ee") : s)))).toBe(false);
    expect(verifyPulseProof(t.root, depth, 2, hashes[1], proof)).toBe(false);
    expect(verifyPulseProof(t.root, depth, 3, hashes[2], proof)).toBe(false); // index is positional
    expect(verifyPulseProof(rep("ee"), depth, 2, hashes[2], proof)).toBe(false);
    expect(verifyPulseProof(t.root, depth, 2, hashes[2], proof.slice(1))).toBe(false);
    expect(verifyPulseProof(t.root, depth, 2 ** depth, hashes[2], proof)).toBe(false); // out of range
    expect(verifyPulseProof(t.root, depth, -1, hashes[2], proof)).toBe(false);
  });

  it("a stale proof still verifies against its OLD root but fails against the newer one", () => {
    const depth = 4;
    const t = new SparsePulseTree(depth);
    const leaf0 = pulseLeafHash(leafOf(0));
    const leaf1 = pulseLeafHash(leafOf(1));
    t.setLeaf(0, leaf0);
    t.setLeaf(1, leaf1);
    const oldRoot = t.root;
    const staleProofOf1 = t.proof(1);

    t.setLeaf(0, pulseLeafHash(leafOf(0, { status: 1, statusSeq: 2 }))); // leaf 0 is leaf 1's sibling
    expect(verifyPulseProof(oldRoot, depth, 1, leaf1, staleProofOf1)).toBe(true);
    expect(verifyPulseProof(t.root, depth, 1, leaf1, staleProofOf1)).toBe(false);
    expect(verifyPulseProof(t.root, depth, 1, leaf1, t.proof(1))).toBe(true);
  });

  it("an index outside the tree is refused (capacity)", () => {
    const t = new SparsePulseTree(2); // capacity 4
    for (let i = 0; i < 4; i++) t.setLeaf(i, pulseLeafHash(leafOf(i)));
    expect(() => t.setLeaf(4, pulseLeafHash(leafOf(4)))).toThrow(/out of range/);
    expect(() => siblingCoordinates(2, 4)).toThrow();
    expect(pulseCapacity(2)).toBe(4);
  });
});

describe("history: replaying the append-only update log", () => {
  function buildLog(depth: number, ops: { index: number; hash: string }[]) {
    const t = new SparsePulseTree(depth);
    const log: PulseLogEntry[] = [];
    ops.forEach((op, i) => {
      const previousRoot = t.root;
      const newRoot = t.setLeaf(op.index, op.hash);
      log.push({ rootSeq: i + 1, leafIndex: op.index, newLeafHash: op.hash, previousRoot, newRoot });
    });
    return { log, finalRoot: t.root };
  }

  const ops = [
    { index: 0, hash: pulseLeafHash(leafOf(0)) },
    { index: 1, hash: pulseLeafHash(leafOf(1)) },
    { index: 2, hash: pulseLeafHash(leafOf(2)) },
    { index: 0, hash: pulseLeafHash(leafOf(0, { status: 1, statusSeq: 2 })) },
  ];

  it("reproduces every recorded root and yields proofs against any historical root", () => {
    const depth = 5;
    const { log, finalRoot } = buildLog(depth, ops);
    for (let seq = 1; seq <= log.length; seq++) {
      const replayed = replayPulseLog(depth, log.slice(0, seq));
      expect(replayed.root).toBe(log[seq - 1].newRoot);
    }
    // "Leaf 0 was ACTIVE as of rootSeq 3" is still provable after it ended at rootSeq 4.
    const atSeq3 = replayPulseLog(depth, log.slice(0, 3));
    expect(verifyPulseProof(log[2].newRoot, depth, 0, ops[0].hash, atSeq3.proof(0))).toBe(true);
    // ...and not against the current root.
    expect(verifyPulseProof(finalRoot, depth, 0, ops[0].hash, atSeq3.proof(0))).toBe(false);
    // The current root proves the ENDED state.
    const atSeq4 = replayPulseLog(depth, log);
    expect(verifyPulseProof(finalRoot, depth, 0, ops[3].hash, atSeq4.proof(0))).toBe(true);
  });

  it("fails loudly on a corrupt log: wrong root, gap, reorder or wrong previousRoot", () => {
    const depth = 5;
    const { log } = buildLog(depth, ops);
    const wrongRoot = log.map((e, i) => (i === 1 ? { ...e, newRoot: rep("ee") } : e));
    expect(() => replayPulseLog(depth, wrongRoot)).toThrow(/newRoot mismatch/);
    expect(() => replayPulseLog(depth, [log[0], log[2]])).toThrow(/gap/);
    expect(() => replayPulseLog(depth, [log[1], log[0]])).toThrow(/gap|out of order/);
    const wrongPrev = log.map((e, i) => (i === 2 ? { ...e, previousRoot: rep("ee") } : e));
    expect(() => replayPulseLog(depth, wrongPrev)).toThrow(/previousRoot mismatch/);
    const tampered = log.map((e, i) => (i === 0 ? { ...e, newLeafHash: rep("ee") } : e));
    expect(() => replayPulseLog(depth, tampered)).toThrow();
  });
});

describe("time does not touch the tree", () => {
  it("advancing the clock by a month changes no root, node or proof (the engine has no clock)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const t = new SparsePulseTree(5);
    t.setLeaf(0, pulseLeafHash(leafOf(0)));
    const root = t.root;
    const proof = t.proof(0);
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    vi.advanceTimersByTime(45 * 24 * 3600 * 1000);
    expect(t.root).toBe(root);
    expect(t.proof(0)).toEqual(proof);
    expect(verifyPulseProof(root, 5, 0, pulseLeafHash(leafOf(0)), proof)).toBe(true);
  });
});

describe("property: incremental updates equal a from-scratch rebuild", () => {
  for (const seed of [1, 7, 42, 2026, 31337]) {
    it(`random insert/update sequence (seed ${seed})`, () => {
      const depth = 5; // capacity 32
      const rnd = mulberry32(seed);
      const t = new SparsePulseTree(depth);
      const leaves = new Map<number, string>();
      let next = 0;
      const seenRoots = new Set<string>();

      for (let step = 0; step < 120; step++) {
        const insert = next < pulseCapacity(depth) && (leaves.size === 0 || rnd() < 0.4);
        const index = insert ? next++ : Math.floor(rnd() * next);
        const hash = pulseLeafHash(leafOf(index, { statusSeq: 1 + Math.floor(rnd() * 1000), status: rnd() < 0.5 ? 0 : 1, statusEffectiveAt: BigInt(Math.floor(rnd() * 1e9)) }));
        leaves.set(index, hash);
        const root = t.setLeaf(index, hash);
        expect(root, `step ${step}`).toBe(referencePulseRoot(depth, leaves));
        seenRoots.add(root);
      }
      // Every stored leaf proves against the final root.
      for (const [i, h] of leaves) expect(verifyPulseProof(t.root, depth, i, h, t.proof(i))).toBe(true);
      expect(seenRoots.size).toBeGreaterThan(20);
    });
  }
});
