import type { Actor } from "@/lib/auth/authorize";
import { DomainError } from "@/server/candidate/errors";
import { inTransaction, isUuid, type IssuanceDb } from "@/server/issuance/common";
import { assertIssuer, assertStillActiveMember, type IssuerScope } from "@/server/issuer/review";
import { addCredentialToOpenBatch } from "./cohort";
import { insertPulseLeaf } from "./pulse";

// Routes a SIGNED credential into the right Merkle engine (ARCHITECTURE §6.1/§6.3):
//   PERMANENT, EXPIRING -> the organisation's OPEN CohortProof batch
//   CONTINUING          -> the organisation's ProofPulse tree
// Runs in its own transaction and is idempotent, so it can be retried safely.

export type EnqueueOutcome = {
  engine: "COHORT" | "PROOF_PULSE";
  pipelineStatus: "SIGNED" | "QUEUED_FOR_ANCHOR" | "ANCHORED";
  alreadyQueued: boolean;
};

export async function enqueueSignedCredential(
  db: IssuanceDb,
  scope: IssuerScope,
  credentialRowId: string,
  opts: { now?: Date } = {},
): Promise<EnqueueOutcome> {
  if (!isUuid(credentialRowId)) throw new DomainError("NOT_FOUND", "Credential not found.");
  const now = opts.now ?? new Date();

  return inTransaction(db, async (tx) => {
    await assertStillActiveMember(tx, scope);
    const credential = await tx.credential.findFirst({
      where: { id: credentialRowId, organisationId: scope.organisationId },
      select: { lifecycleType: true, pipelineStatus: true },
    });
    if (!credential) throw new DomainError("NOT_FOUND", "Credential not found.");
    if (credential.pipelineStatus === "AWAITING_SIGNATURE") throw new DomainError("CONFLICT", "This credential has not been signed.");

    if (credential.lifecycleType === "CONTINUING") {
      const r = await insertPulseLeaf(tx, scope, credentialRowId, now);
      return { engine: "PROOF_PULSE" as const, pipelineStatus: r.pipelineStatus as EnqueueOutcome["pipelineStatus"], alreadyQueued: r.alreadyQueued };
    }
    const r = await addCredentialToOpenBatch(tx, scope, credentialRowId, now);
    return { engine: "COHORT" as const, pipelineStatus: r.pipelineStatus as EnqueueOutcome["pipelineStatus"], alreadyQueued: r.alreadyQueued };
  });
}

/** Retry sweep: queues every SIGNED-but-not-yet-queued credential of the issuer's organisation. */
export async function enqueuePendingForOrganisation(db: IssuanceDb, actor: Actor, opts: { now?: Date } = {}) {
  const scope = assertIssuer(actor);
  const pending = await db.credential.findMany({
    where: { organisationId: scope.organisationId, pipelineStatus: "SIGNED" },
    orderBy: { issuedAt: "asc" },
    take: 100,
    select: { id: true },
  });
  const results: { credentialRowId: string; queued: boolean; error?: string }[] = [];
  for (const { id } of pending) {
    try {
      const r = await enqueueSignedCredential(db, scope, id, opts);
      results.push({ credentialRowId: id, queued: r.pipelineStatus === "QUEUED_FOR_ANCHOR" });
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      results.push({ credentialRowId: id, queued: false, error: e.message });
    }
  }
  return results;
}
