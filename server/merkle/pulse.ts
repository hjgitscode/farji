import type { Actor } from "@/lib/auth/authorize";
import { PULSE_STATUS_CODE, SCOPE_CODE } from "@/lib/crypto/constants";
import { unixSecondsToDate } from "@/lib/crypto/encoding";
import { Prisma } from "@/lib/database/generated/client";
import {
  computePathUpdate,
  DEFAULT_PULSE_DEPTH,
  emptyPulseRoot,
  pulseCapacity,
  pulseLeafHash,
  pulseScopeFor,
  replayPulseLog,
  siblingCoordinates,
  verifyPulseProof,
  zeroHashes,
} from "@/lib/merkle/pulse";
import { DomainError } from "@/server/candidate/errors";
import { audit, isUuid, type IssuanceDb, type Tx } from "@/server/issuance/common";
import { assertIssuer, type IssuerScope } from "@/server/issuer/review";
import { loadIssuedCredential, lockOrganisation, markQueued, type IssuedCredential } from "./material";

// ProofPulse persistence (ROADMAP Phase 7B): ONE incremental fixed-depth tree per Organisation,
// holding CONTINUING credentials only.
//
// Every mutation is one database transaction that
//   (1) locks the tree row (FOR NO KEY UPDATE), serialising writers per organisation,
//   (2) re-reads the tree and checks capacity / leaf state,
//   (3) recomputes ONLY the leaf's `depth + 1` path nodes (never the whole tree),
//   (4) advances currentRoot/currentRootSeq with a conditional update on the expected rootSeq,
//       so two writers can never both derive from the same old root, then
//   (5) upserts those nodes and appends the ProofPulseUpdate.
// ProofPulseUpdate is the permanent root history; node/leaf rows are a rewritable projection.
// Time passing never changes the tree, and anchoring (Phase 9) only reads currentRoot.

export type Tree = { id: string; organisationId: string; depth: number; currentRoot: string | null; currentRootSeq: number; nextLeafIndex: number };

async function getOrCreateTree(tx: Tx, organisationId: string): Promise<Tree> {
  const found = await tx.proofPulseTree.findUnique({ where: { organisationId } });
  if (found) return found;
  // Creation is serialised by the organisation lock, so there is never a unique-violation race.
  await lockOrganisation(tx, organisationId);
  const again = await tx.proofPulseTree.findUnique({ where: { organisationId } });
  if (again) return again;
  return tx.proofPulseTree.create({
    data: { organisationId, depth: DEFAULT_PULSE_DEPTH, currentRoot: emptyPulseRoot(DEFAULT_PULSE_DEPTH), currentRootSeq: 0, nextLeafIndex: 0 },
  });
}

/** Locks the tree row and returns its FRESH state: nothing read before the lock is trusted. */
async function lockTree(tx: Tx, treeId: string): Promise<Tree> {
  await tx.$queryRaw`SELECT "id" FROM "ProofPulseTree" WHERE "id" = ${treeId}::uuid FOR NO KEY UPDATE`;
  return tx.proofPulseTree.findUniqueOrThrow({ where: { id: treeId } });
}

async function loadSiblings(tx: Tx, tree: Tree, leafIndex: number): Promise<Map<string, string>> {
  const coords = siblingCoordinates(tree.depth, leafIndex);
  const rows = await tx.proofPulseNode.findMany({
    where: { treeId: tree.id, OR: coords.map((c) => ({ level: c.level, position: c.position })) },
    select: { level: true, position: true, hash: true },
  });
  return new Map(rows.map((r) => [`${r.level}:${r.position}`, r.hash]));
}

/**
 * Steps (3)-(5): the O(depth) path update, the optimistic root advance and the history row.
 * The conditional advance on the EXPECTED rootSeq comes first, so a writer working from a stale
 * snapshot is refused cleanly (CONFLICT) before anything else is written; everything is one
 * transaction, so a later failure rolls the advance back.
 */
export async function commitPathUpdate(
  tx: Tx,
  tree: Tree,
  leafIndex: number,
  leafHash: string,
  kind: "INSERT" | "STATUS_CHANGE",
  attestationId: string,
  nextLeafIndex: number,
  now: Date,
): Promise<{ rootSeq: number; newRoot: string }> {
  const siblings = await loadSiblings(tx, tree, leafIndex);
  const { nodes, root } = computePathUpdate(tree.depth, leafIndex, leafHash, (l, p) => siblings.get(`${l}:${p}`));

  const previousRoot = tree.currentRoot ?? emptyPulseRoot(tree.depth);
  const rootSeq = tree.currentRootSeq + 1;
  const { count } = await tx.proofPulseTree.updateMany({
    where: { id: tree.id, currentRootSeq: tree.currentRootSeq },
    data: { currentRoot: root, currentRootSeq: rootSeq, nextLeafIndex },
  });
  if (count !== 1) throw new DomainError("CONFLICT", "The ProofPulse tree changed concurrently. Try again.");

  const rows = nodes.map((n) => Prisma.sql`(${tree.id}::uuid, ${n.level}::int, ${n.position}::int, ${n.hash}, ${now}::timestamptz)`);
  await tx.$executeRaw`INSERT INTO "ProofPulseNode" ("treeId", "level", "position", "hash", "updatedAt")
    VALUES ${Prisma.join(rows)}
    ON CONFLICT ("treeId", "level", "position") DO UPDATE SET "hash" = EXCLUDED."hash", "updatedAt" = EXCLUDED."updatedAt"`;

  await tx.proofPulseUpdate.create({
    data: { treeId: tree.id, rootSeq, kind, leafIndex, newLeafHash: leafHash, previousRoot, newRoot: root, causedByAttestationId: attestationId },
  });
  return { rootSeq, newRoot: root };
}

export type PulseEnqueueResult = { pipelineStatus: IssuedCredential["pipelineStatus"]; alreadyQueued: boolean; leafIndex: number; rootSeq?: number };

/** Inserts a SIGNED CONTINUING credential at the next free index. Idempotent. */
export async function insertPulseLeaf(tx: Tx, scope: IssuerScope, credentialRowId: string, now: Date): Promise<PulseEnqueueResult> {
  const credential = await loadIssuedCredential(tx, scope, credentialRowId);
  if (credential.lifecycleType !== "CONTINUING") {
    throw new DomainError("CONFLICT", "Only CONTINUING credentials belong in ProofPulse.");
  }
  const existing = await tx.proofPulseLeaf.findUnique({ where: { credentialRowId: credential.id }, select: { leafIndex: true } });
  if (existing) return { pipelineStatus: credential.pipelineStatus, alreadyQueued: true, leafIndex: existing.leafIndex };
  if (credential.pipelineStatus !== "SIGNED") throw new DomainError("CONFLICT", "Only a SIGNED credential can be queued.");

  const tree = await lockTree(tx, (await getOrCreateTree(tx, scope.organisationId)).id);
  const again = await tx.proofPulseLeaf.findUnique({ where: { credentialRowId: credential.id }, select: { leafIndex: true } });
  if (again) return { pipelineStatus: "QUEUED_FOR_ANCHOR", alreadyQueued: true, leafIndex: again.leafIndex };

  // Capacity: nothing is written and the credential stays SIGNED, never silently dropped.
  if (tree.nextLeafIndex >= pulseCapacity(tree.depth)) {
    throw new DomainError("CONFLICT", "This organisation's ProofPulse tree is full.");
  }

  const leafIndex = tree.nextLeafIndex; // assigned once, kept forever (never reused)
  const scopeName = pulseScopeFor(credential.category);
  const leafHash = pulseLeafHash({
    orgId: credential.orgId,
    leafIndex,
    credentialId: credential.credentialId,
    subjectCommitment: credential.subjectCommitment,
    contentDigest: credential.contentDigest,
    scope: SCOPE_CODE[scopeName],
    status: PULSE_STATUS_CODE.ACTIVE,
    statusEffectiveAt: credential.validFrom,
    statusSeq: 1,
  });

  await tx.proofPulseLeaf.create({
    data: {
      treeId: tree.id,
      organisationId: scope.organisationId,
      credentialRowId: credential.id,
      leafIndex,
      scope: scopeName,
      status: "ACTIVE",
      statusSeq: 1,
      statusEffectiveAt: unixSecondsToDate(credential.validFrom),
      leafHash,
    },
  });
  const { rootSeq } = await commitPathUpdate(tx, tree, leafIndex, leafHash, "INSERT", credential.attestationId, leafIndex + 1, now);
  await markQueued(tx, credential.id);
  await audit(tx, scope, "PULSE_LEAF_INSERTED", "Credential", credential.id, { leafIndex, rootSeq });
  return { pipelineStatus: "QUEUED_FOR_ANCHOR", alreadyQueued: false, leafIndex, rootSeq };
}

/**
 * ACTIVE -> ENDED for one leaf. `statusSeq` must be exactly the leaf's current statusSeq + 1.
 * ENDED is NOT revocation: no Revocation row, no second Credential, nothing is deleted.
 */
export async function applyPulseStatusChange(
  tx: Tx,
  scope: IssuerScope,
  credentialRowId: string,
  change: { attestationId: string; effectiveAt: bigint; statusSeq: number },
  now: Date,
): Promise<{ leafIndex: number; rootSeq: number; newRoot: string }> {
  const credential = await loadIssuedCredential(tx, scope, credentialRowId);
  const leafRef = await tx.proofPulseLeaf.findFirst({ where: { credentialRowId: credential.id }, select: { treeId: true } });
  if (!leafRef) throw new DomainError("CONFLICT", "This credential has no ProofPulse leaf.");

  const tree = await lockTree(tx, leafRef.treeId);
  const leaf = await tx.proofPulseLeaf.findUniqueOrThrow({ where: { credentialRowId: credential.id } });
  if (leaf.status !== "ACTIVE") throw new DomainError("CONFLICT", "This leaf has already ended.");
  if (change.statusSeq !== leaf.statusSeq + 1) throw new DomainError("CONFLICT", "Stale status sequence.");

  const scopeName = pulseScopeFor(credential.category);
  const leafHash = pulseLeafHash({
    orgId: credential.orgId,
    leafIndex: leaf.leafIndex,
    credentialId: credential.credentialId,
    subjectCommitment: credential.subjectCommitment,
    contentDigest: credential.contentDigest,
    scope: SCOPE_CODE[scopeName],
    status: PULSE_STATUS_CODE.ENDED,
    statusEffectiveAt: change.effectiveAt,
    statusSeq: change.statusSeq,
  });

  await tx.proofPulseLeaf.update({
    where: { id: leaf.id },
    data: { status: "ENDED", statusSeq: change.statusSeq, statusEffectiveAt: unixSecondsToDate(change.effectiveAt), leafHash },
  });
  const { rootSeq, newRoot } = await commitPathUpdate(tx, tree, leaf.leafIndex, leafHash, "STATUS_CHANGE", change.attestationId, tree.nextLeafIndex, now);
  await audit(tx, scope, "PULSE_LEAF_ENDED", "Credential", credential.id, { leafIndex: leaf.leafIndex, statusSeq: change.statusSeq, rootSeq });
  return { leafIndex: leaf.leafIndex, rootSeq, newRoot };
}

// ───────────────────────────── proofs ─────────────────────────────

export type PulseProof = {
  depth: number;
  leafIndex: number;
  leafHash: string;
  siblings: string[];
  root: string;
  rootSeq: number;
};

/** Proof of the credential's leaf against the CURRENT root. */
export async function getPulseProof(db: IssuanceDb, actor: Actor, credentialRowId: string): Promise<PulseProof> {
  const scope = assertIssuer(actor);
  if (!isUuid(credentialRowId)) throw new DomainError("NOT_FOUND", "Credential not found.");
  const leaf = await db.proofPulseLeaf.findFirst({ where: { credentialRowId, organisationId: scope.organisationId } });
  if (!leaf || !leaf.leafHash) throw new DomainError("NOT_FOUND", "No ProofPulse leaf for this credential.");
  const tree = await db.proofPulseTree.findUniqueOrThrow({ where: { id: leaf.treeId } });
  const coords = siblingCoordinates(tree.depth, leaf.leafIndex);
  const rows = await db.proofPulseNode.findMany({
    where: { treeId: tree.id, OR: coords.map((c) => ({ level: c.level, position: c.position })) },
    select: { level: true, position: true, hash: true },
  });
  const map = new Map(rows.map((r) => [`${r.level}:${r.position}`, r.hash]));
  const zero = zeroHashes(tree.depth);
  const siblings = coords.map((c) => map.get(`${c.level}:${c.position}`) ?? zero[c.level]);
  const root = tree.currentRoot ?? zero[tree.depth];

  // Reads are not one snapshot: if a writer slipped in between, say so rather than return a bad proof.
  if (!verifyPulseProof(root, tree.depth, leaf.leafIndex, leaf.leafHash, siblings)) {
    throw new DomainError("CONFLICT", "The tree changed while the proof was read. Try again.");
  }
  return { depth: tree.depth, leafIndex: leaf.leafIndex, leafHash: leaf.leafHash, siblings, root, rootSeq: tree.currentRootSeq };
}

/**
 * Proof of the credential's leaf against the root as it stood at `rootSeq`, rebuilt by replaying
 * the append-only ProofPulseUpdate log. The replay must reproduce every recorded root, so a
 * corrupt log fails loudly instead of yielding a plausible proof.
 */
export async function getHistoricalPulseProof(db: IssuanceDb, actor: Actor, credentialRowId: string, rootSeq: number): Promise<PulseProof> {
  const scope = assertIssuer(actor);
  if (!isUuid(credentialRowId)) throw new DomainError("NOT_FOUND", "Credential not found.");
  if (!Number.isInteger(rootSeq) || rootSeq < 1) throw new DomainError("NOT_FOUND", "No such ProofPulse root.");

  const leaf = await db.proofPulseLeaf.findFirst({ where: { credentialRowId, organisationId: scope.organisationId }, select: { treeId: true, leafIndex: true } });
  if (!leaf) throw new DomainError("NOT_FOUND", "No ProofPulse leaf for this credential.");
  const tree = await db.proofPulseTree.findUniqueOrThrow({ where: { id: leaf.treeId }, select: { id: true, depth: true } });

  const log = await db.proofPulseUpdate.findMany({
    where: { treeId: tree.id, rootSeq: { lte: rootSeq } },
    orderBy: { rootSeq: "asc" },
    select: { rootSeq: true, leafIndex: true, newLeafHash: true, previousRoot: true, newRoot: true },
  });
  if (log.length !== rootSeq) throw new DomainError("NOT_FOUND", "No such ProofPulse root.");

  const replayed = replayPulseLog(tree.depth, log);
  const lastForLeaf = [...log].reverse().find((u) => u.leafIndex === leaf.leafIndex);
  if (!lastForLeaf) throw new DomainError("NOT_FOUND", "This leaf was not in the tree at that root.");

  const root = log[log.length - 1].newRoot;
  const siblings = replayed.proof(leaf.leafIndex);
  if (!verifyPulseProof(root, tree.depth, leaf.leafIndex, lastForLeaf.newLeafHash, siblings)) {
    throw new DomainError("CONFLICT", "The ProofPulse history is inconsistent.");
  }
  return { depth: tree.depth, leafIndex: leaf.leafIndex, leafHash: lastForLeaf.newLeafHash, siblings, root, rootSeq };
}
