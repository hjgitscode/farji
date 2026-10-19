import { argBig, argStr, decodeRegistryLogs, ORG_STATUS_FROM_CODE, REVOCATION_REASON_FROM_CODE, type RegistryEvent } from "@/lib/blockchain/registry";
import { chainRootOf } from "@/lib/crypto/chain-root";
import { credentialIdOf } from "@/lib/crypto/commitments";
import type { AttestationTypeName } from "@/lib/crypto/constants";
import type { Prisma, TxPurpose } from "@/lib/database/generated/client";
import { DomainError } from "@/server/candidate/errors";
import type { RpcReceipt } from "./rpc";

// The finalised-evidence mirror (BLOCKCHAIN_MODEL §13, ROADMAP decision C).
//
// This is the ONLY code that turns chain facts into positive FARJI evidence: IssuerKey, Anchor,
// Revocation, Organisation status and Credential ANCHORED. It runs inside the same database
// transaction that moves a BlockchainTransaction CONFIRMED -> FINALIZED, so none of it can exist
// for a transaction that is not finalised. Rules:
//  - events are decoded ONLY from the configured registry address;
//  - a chain fact with no local target is recorded in the audit trail and never transitions
//    unrelated application data;
//  - every write is idempotent (re-running the mirror for the same transaction is a no-op);
//  - nothing is ever deleted or overwritten.

type Tx = Prisma.TransactionClient;

export type MirrorRow = { id: string; purpose: TxPurpose; targetType: string; targetId: string };

export type MirrorSummary = { events: string[]; anchors: number; revocations: number; credentialsAnchored: number; unmatched: number };

const bn = (v: bigint | number) => BigInt(v);
const dateOf = (seconds: bigint | number) => new Date(Number(seconds) * 1000);

export async function mirrorFinalizedTransaction(
  tx: Tx,
  row: MirrorRow,
  receipt: Pick<RpcReceipt, "logs" | "blockNumber">,
  blockTimestamp: number,
  registry: string,
): Promise<MirrorSummary> {
  const events = decodeRegistryLogs(receipt.logs, registry).sort((a, b) => a.logIndex - b.logIndex);
  const summary: MirrorSummary = { events: events.map((e) => e.name), anchors: 0, revocations: 0, credentialsAnchored: 0, unmatched: 0 };
  const ctx = { tx, row, receipt, blockTimestamp, summary };

  for (const e of events) {
    switch (e.name) {
      case "OrganisationRegistered":
        await onOrganisationRegistered(ctx, e);
        break;
      case "OrganisationStatusChanged":
        await onOrganisationStatusChanged(ctx, e);
        break;
      case "IssuerWalletAuthorised":
        await onWalletAuthorised(ctx, e);
        break;
      case "IssuerWalletRetired":
        await onWalletRetired(ctx, e);
        break;
      case "IssuerWalletCompromised":
        await onWalletCompromised(ctx, e);
        break;
      case "CohortRootAnchored":
        await onAnchored(ctx, e, "COHORT");
        break;
      case "ProofPulseEpochAnchored":
        await onAnchored(ctx, e, "PROOF_PULSE");
        break;
      case "CredentialRevoked":
        await onRevoked(ctx, e);
        break;
      default:
        break; // rotated (covered by its retire + authorise events), pause events, role events
    }
  }

  await tx.auditEvent.create({
    data: {
      action: "CHAIN_TX_FINALIZED",
      targetType: "BlockchainTransaction",
      targetId: row.id,
      metadata: { events: summary.events, anchors: summary.anchors, revocations: summary.revocations, credentialsAnchored: summary.credentialsAnchored, unmatched: summary.unmatched, blockNumber: receipt.blockNumber },
    },
  });
  return summary;
}

type Ctx = { tx: Tx; row: MirrorRow; receipt: Pick<RpcReceipt, "logs" | "blockNumber">; blockTimestamp: number; summary: MirrorSummary };

async function unmatched(c: Ctx, e: RegistryEvent, why: string) {
  c.summary.unmatched += 1;
  await c.tx.auditEvent.create({
    data: {
      action: "CHAIN_EVENT_UNMATCHED",
      targetType: "BlockchainTransaction",
      targetId: c.row.id,
      metadata: { event: e.name, reason: why, orgId: typeof e.args.orgId === "string" ? e.args.orgId : null },
    },
  });
}

const orgByOnChainId = (tx: Tx, orgId: string) => tx.organisation.findUnique({ where: { orgId }, select: { id: true, status: true, orgId: true } });

async function onOrganisationRegistered(c: Ctx, e: RegistryEvent) {
  const org = await orgByOnChainId(c.tx, argStr(e, "orgId"));
  if (!org) return unmatched(c, e, "organisation not in the database");
  // PENDING_ONBOARDING -> ACTIVE only: a registered organisation never goes backwards.
  await c.tx.organisation.updateMany({ where: { id: org.id, status: "PENDING_ONBOARDING" }, data: { status: "ACTIVE" } });
}

async function onOrganisationStatusChanged(c: Ctx, e: RegistryEvent) {
  const org = await orgByOnChainId(c.tx, argStr(e, "orgId"));
  if (!org) return unmatched(c, e, "organisation not in the database");
  const status = ORG_STATUS_FROM_CODE[Number(argBig(e, "status"))];
  if (!status) return unmatched(c, e, "unknown status code");
  await c.tx.organisation.update({ where: { id: org.id }, data: { status } });
}

async function onWalletAuthorised(c: Ctx, e: RegistryEvent) {
  const org = await orgByOnChainId(c.tx, argStr(e, "orgId"));
  if (!org) return unmatched(c, e, "organisation not in the database");
  const wallet = argStr(e, "wallet");
  const existing = await c.tx.issuerKey.findUnique({ where: { walletAddress: wallet }, select: { id: true, organisationId: true, authoriseTransactionId: true } });
  if (!existing) {
    await c.tx.issuerKey.create({
      data: { organisationId: org.id, walletAddress: wallet, validFrom: dateOf(argBig(e, "validFrom")), authoriseTransactionId: c.row.id },
    });
  } else if (existing.organisationId !== org.id) {
    await unmatched(c, e, "wallet already mirrored for a different organisation");
  } else if (!existing.authoriseTransactionId) {
    await c.tx.issuerKey.update({ where: { id: existing.id }, data: { authoriseTransactionId: c.row.id } });
  }
}

async function onWalletRetired(c: Ctx, e: RegistryEvent) {
  const org = await orgByOnChainId(c.tx, argStr(e, "orgId"));
  if (!org) return unmatched(c, e, "organisation not in the database");
  const { count } = await c.tx.issuerKey.updateMany({
    where: { walletAddress: argStr(e, "wallet"), organisationId: org.id, validUntil: null },
    data: { validUntil: dateOf(argBig(e, "validUntil")), retireTransactionId: c.row.id },
  });
  if (count === 0) {
    const known = await c.tx.issuerKey.findUnique({ where: { walletAddress: argStr(e, "wallet") }, select: { id: true } });
    if (!known) await unmatched(c, e, "wallet not mirrored (authorisation not synced yet)");
  }
}

async function onWalletCompromised(c: Ctx, e: RegistryEvent) {
  const org = await orgByOnChainId(c.tx, argStr(e, "orgId"));
  if (!org) return unmatched(c, e, "organisation not in the database");
  const wallet = argStr(e, "wallet");
  const key = await c.tx.issuerKey.findUnique({ where: { walletAddress: wallet }, select: { id: true, organisationId: true, validUntil: true, compromisedAt: true } });
  if (!key || key.organisationId !== org.id) return unmatched(c, e, "wallet not mirrored");
  if (!key.compromisedAt) {
    await c.tx.issuerKey.update({ where: { id: key.id }, data: { compromisedAt: dateOf(argBig(e, "compromisedAt")) } });
  }
  if (!key.validUntil) {
    await c.tx.issuerKey.update({ where: { id: key.id }, data: { validUntil: dateOf(argBig(e, "validUntil")), retireTransactionId: c.row.id } });
  }
}

async function onAnchored(c: Ctx, e: RegistryEvent, type: AttestationTypeName) {
  const org = await orgByOnChainId(c.tx, argStr(e, "orgId"));
  if (!org) return unmatched(c, e, "organisation not in the database");
  const expectedPurpose: TxPurpose = type === "COHORT" ? "ANCHOR_COHORT" : "ANCHOR_PROOF_PULSE";
  if (c.row.purpose !== expectedPurpose) return unmatched(c, e, "anchor event in a transaction of a different purpose");

  const chainRoot = argStr(e, "chainRoot");
  const batchRoot = argStr(e, "batchRoot");
  const previousChainRoot = argStr(e, "previousChainRoot");
  const epoch = argBig(e, "epoch");
  // The contract computes chainRoot itself; recomputing it here guards against any decoding or mirroring slip.
  if (chainRootOf(batchRoot, previousChainRoot, org.orgId, type, epoch) !== chainRoot) {
    throw new DomainError("CONFLICT", "Anchor chainRoot does not match the TypeScript formula; refusing to mirror.");
  }
  const anchorer = await c.tx.issuerKey.findUnique({ where: { walletAddress: argStr(e, "anchoredBy") }, select: { id: true, organisationId: true } });
  if (!anchorer || anchorer.organisationId !== org.id) {
    // The authorisation transaction has not been synced yet: leave this transaction CONFIRMED and retry.
    throw new DomainError("CONFLICT", "The anchoring wallet's authorisation has not been mirrored yet.");
  }

  let anchor = await c.tx.anchor.findUnique({ where: { chainRoot }, select: { id: true } });
  if (!anchor) {
    anchor = await c.tx.anchor.create({
      data: {
        organisationId: org.id,
        attestationType: type,
        epoch: Number(epoch),
        batchRoot,
        previousChainRoot,
        chainRoot,
        rootSeq: type === "PROOF_PULSE" ? Number(argBig(e, "rootSeq")) : null,
        leafCount: Number(argBig(e, "leafCount")),
        anchorerKeyId: anchorer.id,
        transactionId: c.row.id,
        blockNumber: bn(c.receipt.blockNumber),
        blockTimestamp: dateOf(c.blockTimestamp),
      },
      select: { id: true },
    });
    c.summary.anchors += 1;
  }

  if (type === "COHORT") await transitionCohort(c, org.id, anchor.id, batchRoot, Number(argBig(e, "leafCount")));
  else await transitionPulse(c, org.id, Number(argBig(e, "rootSeq")), batchRoot);
}

/** The matching SEALED batch (same organisation, root and leaf count) becomes ANCHORED with its credentials. */
async function transitionCohort(c: Ctx, organisationId: string, anchorId: string, batchRoot: string, leafCount: number) {
  const targeted = c.row.targetType === "COHORT_BATCH" ? c.row.targetId : null;
  const candidates = await c.tx.cohortBatch.findMany({
    where: { organisationId, status: "SEALED", anchorId: null, batchRoot, leafCount },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const batch = candidates.find((b) => b.id === targeted) ?? candidates[0];
  if (!batch) return;
  const { count } = await c.tx.cohortBatch.updateMany({ where: { id: batch.id, status: "SEALED", anchorId: null }, data: { status: "ANCHORED", anchorId } });
  if (count !== 1) return;
  const leaves = await c.tx.cohortLeaf.findMany({ where: { batchId: batch.id }, select: { credentialRowId: true } });
  const moved = await c.tx.credential.updateMany({
    where: { id: { in: leaves.map((l) => l.credentialRowId) }, pipelineStatus: "QUEUED_FOR_ANCHOR" },
    data: { pipelineStatus: "ANCHORED" },
  });
  c.summary.credentialsAnchored += moved.count;
}

/** Credentials whose leaf was inserted at or before the anchored rootSeq are covered by this root. */
async function transitionPulse(c: Ctx, organisationId: string, rootSeq: number, batchRoot: string) {
  const tree = await c.tx.proofPulseTree.findUnique({ where: { organisationId }, select: { id: true } });
  if (!tree) return;
  const update = await c.tx.proofPulseUpdate.findUnique({ where: { treeId_rootSeq: { treeId: tree.id, rootSeq } }, select: { newRoot: true } });
  // Only a root that is in OUR append-only log can cover our leaves.
  if (!update || update.newRoot !== batchRoot) return;
  const inserts = await c.tx.proofPulseUpdate.findMany({ where: { treeId: tree.id, kind: "INSERT", rootSeq: { lte: rootSeq } }, select: { leafIndex: true } });
  if (inserts.length === 0) return;
  const leaves = await c.tx.proofPulseLeaf.findMany({ where: { treeId: tree.id, leafIndex: { in: inserts.map((i) => i.leafIndex) } }, select: { credentialRowId: true } });
  const moved = await c.tx.credential.updateMany({
    where: { id: { in: leaves.map((l) => l.credentialRowId) }, pipelineStatus: "QUEUED_FOR_ANCHOR" },
    data: { pipelineStatus: "ANCHORED" },
  });
  c.summary.credentialsAnchored += moved.count;
}

async function onRevoked(c: Ctx, e: RegistryEvent) {
  const org = await orgByOnChainId(c.tx, argStr(e, "orgId"));
  if (!org) return unmatched(c, e, "organisation not in the database");
  if (c.row.purpose !== "REVOKE_CREDENTIAL") return unmatched(c, e, "revocation event in a transaction of a different purpose");
  const credentialId = argStr(e, "credentialId");
  if (credentialIdOf(org.orgId, argStr(e, "credentialSalt")) !== credentialId) {
    throw new DomainError("CONFLICT", "Revocation credentialId does not match orgId + credentialSalt; refusing to mirror.");
  }
  // Only a credential that belongs to THIS organisation in FARJI's database is ever marked revoked.
  const credential = await c.tx.credential.findFirst({ where: { organisationId: org.id, credentialId }, select: { id: true, revocation: { select: { id: true } } } });
  if (!credential) return unmatched(c, e, "credential not in the database");
  if (credential.revocation) return; // idempotent
  const revoker = await c.tx.issuerKey.findUnique({ where: { walletAddress: argStr(e, "revokedBy") }, select: { id: true, organisationId: true } });
  if (!revoker || revoker.organisationId !== org.id) throw new DomainError("CONFLICT", "The revoking wallet's authorisation has not been mirrored yet.");
  const reasonCode = REVOCATION_REASON_FROM_CODE[Number(argBig(e, "reasonCode"))];
  if (!reasonCode) return unmatched(c, e, "unknown reason code");
  await c.tx.revocation.create({
    data: {
      credentialRowId: credential.id,
      organisationId: org.id,
      revokerKeyId: revoker.id,
      reasonCode,
      transactionId: c.row.id,
      blockNumber: bn(c.receipt.blockNumber),
      revokedAt: dateOf(c.blockTimestamp),
    },
  });
  c.summary.revocations += 1;
}
