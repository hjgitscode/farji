import { chainRootOf } from "@/lib/crypto/chain-root";
import { ZERO_HASH } from "@/lib/crypto/constants";
import { sealCohortBatch } from "@/server/merkle/cohort";
import { freshWallet, TEST_CONFIG } from "../fixtures/test-wallets";
import { mkConfirmedTx, mkFinalizedTx, mkOrg, mkUser, type Tx } from "./helpers";
import { addKey, approvedCredential, issuerOf, PERMANENT, signCredential, SIGN_NOW, type Fixture } from "./issuance-helpers";

// Shared fixtures for DATABASE tests that need real signed credentials and the rows the finalised-evidence mirror writes
// (anchors, batches). Real chain behaviour is covered by tests/chain-int; here the point is derivation from evidence rows.

export const DAY = 86_400_000;
export const at = (days: number) => new Date(SIGN_NOW.getTime() + days * DAY);
export const opts = (now: Date) => ({ now, domain: TEST_CONFIG });

export async function org(tx: Tx) {
  const o = await mkOrg(tx, "ACTIVE");
  const issuer = await issuerOf(tx, o.id);
  const wallet = freshWallet();
  const key = await addKey(tx, o.id, wallet);
  return { orgId: o.id, issuer, wallet, keyId: key.id };
}
export type Ctx = Awaited<ReturnType<typeof org>>;

export async function signed(tx: Tx, ctx: Ctx, draft: Record<string, unknown> = PERMANENT): Promise<Fixture> {
  const f = await approvedCredential(tx, draft, { orgId: ctx.orgId, issuer: ctx.issuer });
  await signCredential(tx, f, ctx.wallet);
  return f;
}

/** What the mirror writes for a FINALIZED cohort anchor: Anchor, batch ANCHORED, credentials ANCHORED. */
export async function anchorCohort(tx: Tx, ctx: Ctx, batchId: string, when: Date, final = true) {
  const batch = await tx.cohortBatch.findUniqueOrThrow({ where: { id: batchId } });
  const organisation = await tx.organisation.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const prior = await tx.anchor.findMany({ where: { organisationId: ctx.orgId, attestationType: "COHORT" }, orderBy: { epoch: "desc" }, take: 1 });
  const epoch = (prior[0]?.epoch ?? 0) + 1;
  const previousChainRoot = prior[0]?.chainRoot ?? ZERO_HASH;
  const txRow = final ? await mkFinalizedTx(tx, "ANCHOR_COHORT", ctx.orgId, "COHORT_BATCH", batchId) : await mkConfirmedTx(tx, "ANCHOR_COHORT", (await mkUser(tx, "ADMIN")).id, ctx.orgId);
  const anchor = await tx.anchor.create({
    data: {
      organisationId: ctx.orgId,
      attestationType: "COHORT",
      epoch,
      batchRoot: batch.batchRoot!,
      previousChainRoot,
      chainRoot: chainRootOf(batch.batchRoot!, previousChainRoot, organisation.orgId, "COHORT", BigInt(epoch)),
      leafCount: batch.leafCount!,
      anchorerKeyId: ctx.keyId,
      transactionId: txRow.id,
      blockNumber: 1n,
      blockTimestamp: when,
    },
  });
  await tx.cohortBatch.update({ where: { id: batchId }, data: { status: "ANCHORED", anchorId: anchor.id } });
  return anchor;
}

/** A PROOF_PULSE epoch snapshotting the tree's CURRENT root and rootSeq (an anchor never recomputes the tree). */
export async function anchorPulse(tx: Tx, ctx: Ctx, when: Date) {
  const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
  const organisation = await tx.organisation.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const prior = await tx.anchor.findMany({ where: { organisationId: ctx.orgId, attestationType: "PROOF_PULSE" }, orderBy: { epoch: "desc" }, take: 1 });
  const epoch = (prior[0]?.epoch ?? 0) + 1;
  const previousChainRoot = prior[0]?.chainRoot ?? ZERO_HASH;
  const txRow = await mkFinalizedTx(tx, "ANCHOR_PROOF_PULSE", ctx.orgId, "PROOF_PULSE_TREE", tree.id);
  return tx.anchor.create({
    data: {
      organisationId: ctx.orgId,
      attestationType: "PROOF_PULSE",
      epoch,
      batchRoot: tree.currentRoot!,
      previousChainRoot,
      chainRoot: chainRootOf(tree.currentRoot!, previousChainRoot, organisation.orgId, "PROOF_PULSE", BigInt(epoch)),
      rootSeq: tree.currentRootSeq,
      leafCount: tree.nextLeafIndex,
      anchorerKeyId: ctx.keyId,
      transactionId: txRow.id,
      blockNumber: 1n,
      blockTimestamp: when,
    },
  });
}

export async function sealAndAnchor(tx: Tx, ctx: Ctx, when: Date, final = true) {
  const sealed = await sealCohortBatch(tx, ctx.issuer, { now: SIGN_NOW });
  const anchor = await anchorCohort(tx, ctx, sealed.batchId, when, final);
  return { sealed, anchor };
}

