import type { Actor } from "@/lib/auth/authorize";
import { SCHEMA_ID } from "@/lib/crypto/constants";
import type { Prisma } from "@/lib/database/generated/client";
import { buildCohortTree, cohortLeafHash, type CohortLeafInput } from "@/lib/merkle/cohort";
import { DomainError } from "@/server/candidate/errors";
import { audit, inTransaction, isUuid, type IssuanceDb, type Tx } from "@/server/issuance/common";
import { assertIssuer, assertStillActiveMember, type IssuerScope } from "@/server/issuer/review";
import { ISSUED_SELECT, loadIssuedCredential, lockOrganisation, markQueued, toIssuedCredential, type IssuedCredential } from "./material";

// CohortProof persistence (ROADMAP Phase 7A). PERMANENT and EXPIRING credentials only.
//
// - A signed credential joins the organisation's single OPEN batch (created on demand).
// - Sealing builds the OpenZeppelin StandardMerkleTree ONCE, writes root/leafCount/sealedAt and
//   each leaf's proof ONCE. A sealed batch is immutable (database triggers); a late entrant goes
//   into the next OPEN batch, never into an old one.
// - Every write for one organisation is serialised by a row lock on the Organisation.

export function cohortLeafOf(c: IssuedCredential): CohortLeafInput {
  return {
    orgId: c.orgId,
    credentialId: c.credentialId,
    subjectCommitment: c.subjectCommitment,
    contentDigest: c.contentDigest,
    lifecycleType: c.lifecycleCode,
    validFrom: c.validFrom,
    validUntil: c.validUntil,
    issuedAt: c.issuedAt,
    schemaId: SCHEMA_ID,
  };
}

export type EnqueueResult = { pipelineStatus: IssuedCredential["pipelineStatus"]; alreadyQueued: boolean; batchId: string };

/** Idempotent: a credential that already has a leaf is returned as-is. */
export async function addCredentialToOpenBatch(tx: Tx, scope: IssuerScope, credentialRowId: string, now: Date): Promise<EnqueueResult> {
  const credential = await loadIssuedCredential(tx, scope, credentialRowId);
  if (credential.lifecycleType === "CONTINUING") {
    throw new DomainError("CONFLICT", "CONTINUING credentials belong in ProofPulse, not CohortProof.");
  }
  const existing = await tx.cohortLeaf.findUnique({ where: { credentialRowId: credential.id }, select: { batchId: true } });
  if (existing) return { pipelineStatus: credential.pipelineStatus, alreadyQueued: true, batchId: existing.batchId };
  if (credential.pipelineStatus !== "SIGNED") throw new DomainError("CONFLICT", "Only a SIGNED credential can be queued.");

  await lockOrganisation(tx, scope.organisationId);
  // Re-check under the lock: a concurrent enqueue of the same credential may have just finished.
  const again = await tx.cohortLeaf.findUnique({ where: { credentialRowId: credential.id }, select: { batchId: true } });
  if (again) return { pipelineStatus: "QUEUED_FOR_ANCHOR", alreadyQueued: true, batchId: again.batchId };

  const batch =
    (await tx.cohortBatch.findFirst({ where: { organisationId: scope.organisationId, status: "OPEN" }, select: { id: true } })) ??
    (await tx.cohortBatch.create({ data: { organisationId: scope.organisationId, label: `Cohort ${now.toISOString().slice(0, 10)}` }, select: { id: true } }));

  const max = await tx.cohortLeaf.aggregate({ where: { batchId: batch.id }, _max: { position: true } });
  const position = (max._max.position ?? -1) + 1;

  await tx.cohortLeaf.create({
    data: {
      batchId: batch.id,
      credentialRowId: credential.id,
      organisationId: scope.organisationId,
      position, // insertion sequence; the tree order is by leaf hash
      leafHash: cohortLeafHash(cohortLeafOf(credential)),
    },
  });
  await markQueued(tx, credential.id);
  await audit(tx, scope, "COHORT_LEAF_ADDED", "Credential", credential.id, { batchId: batch.id, position });
  return { pipelineStatus: "QUEUED_FOR_ANCHOR", alreadyQueued: false, batchId: batch.id };
}

export type SealedBatch = { batchId: string; batchRoot: string; leafCount: number };

export async function sealCohortBatch(db: IssuanceDb, actor: Actor, opts: { now?: Date } = {}): Promise<SealedBatch> {
  const scope = assertIssuer(actor);
  const now = opts.now ?? new Date();

  return inTransaction(db, async (tx) => {
    await assertStillActiveMember(tx, scope);
    await lockOrganisation(tx, scope.organisationId);

    const batch = await tx.cohortBatch.findFirst({
      where: { organisationId: scope.organisationId, status: "OPEN" },
      select: { id: true },
    });
    if (!batch) throw new DomainError("CONFLICT", "There is no open batch to seal.");

    const leaves = await tx.cohortLeaf.findMany({
      where: { batchId: batch.id },
      orderBy: { position: "asc" },
      select: { id: true, leafHash: true, credential: { select: ISSUED_SELECT } },
    });
    if (leaves.length === 0) throw new DomainError("CONFLICT", "An empty batch cannot be sealed.");

    // Rebuild every leaf from the Credential rows and require it to match what was stored.
    const inputs = leaves.map((l) => {
      const issued = toIssuedCredential(l.credential);
      const input = cohortLeafOf(issued);
      if (cohortLeafHash(input) !== l.leafHash) {
        throw new DomainError("CONFLICT", "A stored cohort leaf no longer matches its credential.");
      }
      return input;
    });
    const tree = buildCohortTree(inputs);
    const proofByCredential = new Map(tree.entries.map((e) => [e.credentialId, e]));

    const { count } = await tx.cohortBatch.updateMany({
      where: { id: batch.id, status: "OPEN" },
      data: { status: "SEALED", batchRoot: tree.root, leafCount: tree.leafCount, sealedAt: now },
    });
    if (count !== 1) throw new DomainError("CONFLICT", "The batch was sealed concurrently.");

    for (const leaf of leaves) {
      const entry = proofByCredential.get(leaf.credential.credentialId as string);
      if (!entry || entry.leafHash !== leaf.leafHash) throw new DomainError("CONFLICT", "Proof/leaf mismatch while sealing.");
      await tx.cohortLeaf.update({ where: { id: leaf.id }, data: { proof: entry.proof as unknown as Prisma.InputJsonObject } });
    }

    await audit(tx, scope, "COHORT_BATCH_SEALED", "CohortBatch", batch.id, { leafCount: tree.leafCount, batchRoot: tree.root });
    return { batchId: batch.id, batchRoot: tree.root, leafCount: tree.leafCount };
  });
}

export type CohortProofResult = {
  batchId: string;
  batchStatus: "OPEN" | "SEALED" | "ANCHORED";
  leafHash: string;
  /** null until the batch is sealed (proofs are written once, at sealing). */
  batchRoot: string | null;
  proof: { v: 1; treeIndex: number; siblings: string[] } | null;
};

export async function getCohortProof(db: IssuanceDb, actor: Actor, credentialRowId: string): Promise<CohortProofResult> {
  const scope = assertIssuer(actor);
  if (!isUuid(credentialRowId)) throw new DomainError("NOT_FOUND", "Credential not found.");
  const leaf = await db.cohortLeaf.findFirst({
    where: { credentialRowId, organisationId: scope.organisationId },
    select: { batchId: true, leafHash: true, proof: true, batch: { select: { status: true, batchRoot: true } } },
  });
  if (!leaf) throw new DomainError("NOT_FOUND", "No cohort leaf for this credential.");
  return {
    batchId: leaf.batchId,
    batchStatus: leaf.batch.status,
    leafHash: leaf.leafHash,
    batchRoot: leaf.batch.batchRoot,
    proof: (leaf.proof as CohortProofResult["proof"]) ?? null,
  };
}
