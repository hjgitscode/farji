import { AbiCoder, keccak256 } from "ethers";
import { PULSE_EMPTY_V1, PULSE_LEAF_V1, PULSE_NODE_V1 } from "@/lib/crypto/constants";
import { isBytes32 } from "@/lib/crypto/encoding";

// ProofPulse engine (MERKLE_MODEL §3). Fixed-depth, positional, incremental Merkle tree. Pure:
// no I/O, no clock. Persistence and concurrency live in server/merkle/pulse.ts.
//
//   leaf     = keccak256(keccak256(abi.encode(PULSE_LEAF_V1, orgId, uint32 leafIndex, credentialId,
//                subjectCommitment, contentDigest, uint8 scope, uint8 status,
//                uint64 statusEffectiveAt, uint32 statusSeq)))
//   node     = keccak256(abi.encode(PULSE_NODE_V1, left, right))      (positional, NOT sorted)
//   zero[0]  = keccak256(PULSE_EMPTY_V1);  zero[i+1] = node(zero[i], zero[i])
//
// Level 0 holds leaves, level `depth` holds the root. The node on a leaf's path at level l is at
// position (leafIndex >> l); its sibling is at (leafIndex >> l) ^ 1. A missing node equals zero[level].
// A state change recomputes only the leaf and its `depth` ancestors: O(depth). The tree is never
// rebuilt because time passed, and anchoring only reads the already-current root.

/**
 * ProofPulse scope of a CONTINUING credential, by claim category (ROADMAP D42). A continuing
 * CERTIFICATION is a standing membership of the certifying body.
 */
export function pulseScopeFor(category: string): "EMPLOYMENT" | "ENROLMENT" | "MEMBERSHIP" {
  switch (category) {
    case "EXPERIENCE":
      return "EMPLOYMENT";
    case "EDUCATION":
      return "ENROLMENT";
    case "MEMBERSHIP":
    case "CERTIFICATION":
      return "MEMBERSHIP";
    default:
      throw new Error("Unknown claim category");
  }
}

export const DEFAULT_PULSE_DEPTH = 20;
export const MAX_PULSE_DEPTH = 32;

const abi = AbiCoder.defaultAbiCoder();

export function pulseNodeHash(left: string, right: string): string {
  return keccak256(abi.encode(["bytes32", "bytes32", "bytes32"], [PULSE_NODE_V1, left, right]));
}

function checkDepth(depth: number) {
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_PULSE_DEPTH) throw new Error("depth must be an integer in 1..32");
}

export const pulseCapacity = (depth: number): number => 2 ** depth;

/** zero[0..depth]. `zero[depth]` is the root of an empty tree. */
export function zeroHashes(depth: number): string[] {
  checkDepth(depth);
  const zero = [keccak256(PULSE_EMPTY_V1)];
  for (let i = 0; i < depth; i++) zero.push(pulseNodeHash(zero[i], zero[i]));
  return zero;
}

export const emptyPulseRoot = (depth: number): string => zeroHashes(depth)[depth];

export type PulseLeafInput = {
  orgId: string;
  leafIndex: number;
  credentialId: string;
  subjectCommitment: string;
  contentDigest: string;
  scope: number;
  status: number;
  statusEffectiveAt: bigint;
  statusSeq: number;
};

export function pulseLeafHash(l: PulseLeafInput): string {
  for (const [n, v] of [
    ["orgId", l.orgId],
    ["credentialId", l.credentialId],
    ["subjectCommitment", l.subjectCommitment],
    ["contentDigest", l.contentDigest],
  ] as const) {
    if (!isBytes32(v)) throw new Error(`${n} must be a lowercase 0x bytes32`);
  }
  if (!Number.isInteger(l.leafIndex) || l.leafIndex < 0 || l.leafIndex > 0xffffffff) throw new Error("leafIndex must fit uint32");
  if (!Number.isInteger(l.statusSeq) || l.statusSeq < 1 || l.statusSeq > 0xffffffff) throw new Error("statusSeq must be a uint32 >= 1");
  if (![0, 1, 2].includes(l.scope)) throw new Error("scope must be 0, 1 or 2");
  if (![0, 1].includes(l.status)) throw new Error("status must be 0 (ACTIVE) or 1 (ENDED)");
  const inner = keccak256(
    abi.encode(
      ["bytes32", "bytes32", "uint32", "bytes32", "bytes32", "bytes32", "uint8", "uint8", "uint64", "uint32"],
      [PULSE_LEAF_V1, l.orgId, l.leafIndex, l.credentialId, l.subjectCommitment, l.contentDigest, l.scope, l.status, l.statusEffectiveAt, l.statusSeq],
    ),
  );
  return keccak256(inner);
}

export type PulseNode = { level: number; position: number; hash: string };

/** Looks up a persisted node; `undefined` means "never written", i.e. equal to zero[level]. */
export type NodeLookup = (level: number, position: number) => string | undefined;

/** The (level, position) of every sibling needed to update/prove `leafIndex`: levels 0..depth-1. */
export function siblingCoordinates(depth: number, leafIndex: number): { level: number; position: number }[] {
  checkDepth(depth);
  assertIndex(depth, leafIndex);
  return Array.from({ length: depth }, (_, level) => ({ level, position: Math.floor(leafIndex / 2 ** level) ^ 1 }));
}

function assertIndex(depth: number, leafIndex: number) {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= pulseCapacity(depth)) throw new Error("leafIndex out of range");
}

/**
 * Recomputes the leaf and its ancestors. Returns `depth + 1` nodes (level 0 = the leaf, level
 * `depth` = the root at position 0) and the new root. Exactly `depth` hashes are computed.
 */
export function computePathUpdate(depth: number, leafIndex: number, leafHash: string, lookup: NodeLookup): { nodes: PulseNode[]; root: string } {
  const zero = zeroHashes(depth);
  assertIndex(depth, leafIndex);
  if (!isBytes32(leafHash)) throw new Error("leafHash must be a lowercase 0x bytes32");
  const nodes: PulseNode[] = [{ level: 0, position: leafIndex, hash: leafHash }];
  let hash = leafHash;
  let position = leafIndex;
  for (let level = 0; level < depth; level++) {
    const sibling = lookup(level, position ^ 1) ?? zero[level];
    hash = position % 2 === 0 ? pulseNodeHash(hash, sibling) : pulseNodeHash(sibling, hash);
    position = Math.floor(position / 2);
    nodes.push({ level: level + 1, position, hash });
  }
  return { nodes, root: hash };
}

/** Folds a sibling path (levels 0..depth-1) for `leafIndex` and compares to `root`. */
export function verifyPulseProof(root: string, depth: number, leafIndex: number, leafHash: string, siblings: string[]): boolean {
  if (!isBytes32(root) || !isBytes32(leafHash)) return false;
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_PULSE_DEPTH || siblings.length !== depth) return false;
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= pulseCapacity(depth)) return false;
  let h = leafHash;
  let position = leafIndex;
  for (const sibling of siblings) {
    if (!isBytes32(sibling)) return false;
    h = position % 2 === 0 ? pulseNodeHash(h, sibling) : pulseNodeHash(sibling, h);
    position = Math.floor(position / 2);
  }
  return h === root;
}

/** In-memory sparse tree: used to replay the update log and by tests. */
export class SparsePulseTree {
  readonly depth: number;
  private readonly nodes = new Map<string, string>();
  private readonly zero: string[];

  constructor(depth: number) {
    this.zero = zeroHashes(depth);
    this.depth = depth;
  }

  get root(): string {
    return this.nodes.get(`${this.depth}:0`) ?? this.zero[this.depth];
  }

  lookup: NodeLookup = (level, position) => this.nodes.get(`${level}:${position}`);

  setLeaf(leafIndex: number, leafHash: string): string {
    const { nodes, root } = computePathUpdate(this.depth, leafIndex, leafHash, this.lookup);
    for (const n of nodes) this.nodes.set(`${n.level}:${n.position}`, n.hash);
    return root;
  }

  /** Sibling path (levels 0..depth-1) for any index, present or empty. */
  proof(leafIndex: number): string[] {
    return siblingCoordinates(this.depth, leafIndex).map((c) => this.lookup(c.level, c.position) ?? this.zero[c.level]);
  }
}

export type PulseLogEntry = {
  rootSeq: number;
  leafIndex: number;
  newLeafHash: string;
  previousRoot: string | null;
  newRoot: string;
};

/**
 * Replays the append-only ProofPulseUpdate log (ordered by rootSeq, starting at 1) into a sparse
 * tree. Every step must reproduce the recorded `newRoot` (and `previousRoot`), otherwise the log
 * or the tree is corrupt and the replay throws. This is how a proof against any historical root
 * is rebuilt without keeping historical nodes.
 */
export function replayPulseLog(depth: number, log: PulseLogEntry[]): SparsePulseTree {
  const tree = new SparsePulseTree(depth);
  log.forEach((entry, i) => {
    if (entry.rootSeq !== i + 1) throw new Error("ProofPulse log has a gap or is out of order");
    if (entry.previousRoot !== null && entry.previousRoot !== tree.root) throw new Error(`ProofPulse log previousRoot mismatch at rootSeq ${entry.rootSeq}`);
    if (tree.setLeaf(entry.leafIndex, entry.newLeafHash) !== entry.newRoot) throw new Error(`ProofPulse log newRoot mismatch at rootSeq ${entry.rootSeq}`);
  });
  return tree;
}
