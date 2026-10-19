import { afterAll, describe, expect, it } from "vitest";
import { chainRootOf } from "@/lib/crypto/chain-root";
import { ZERO_HASH } from "@/lib/crypto/constants";
import { verifyCohortProof } from "@/lib/merkle/cohort";
import { verifyPulseProof } from "@/lib/merkle/pulse";
import { acceptCredentialSignature, prepareCredentialSigning } from "@/server/issuance/signing";
import { acceptStatusChange, prepareEndRelationship } from "@/server/issuance/status-change";
import { getCohortProof, sealCohortBatch } from "@/server/merkle/cohort";
import { getHistoricalPulseProof, getPulseProof } from "@/server/merkle/pulse";
import { db, inRollback, type Tx } from "../db/helpers";
import { approvedCredential, CONTINUING, PERMANENT, type Fixture } from "../db/issuance-helpers";
import { buildSendRecord, env, finalise, onboard, signingClock, sync, type Onboarded } from "./harness";

afterAll(async () => {
  await db.$disconnect();
});

/** Signs a credential with the REAL wallet, accepted against the REAL chain's key history. */
async function signOnChain(tx: Tx, o: Onboarded, f: Fixture, clock?: Date) {
  const e = env();
  const now = clock ?? (await signingClock());
  const prep = await prepareCredentialSigning(tx, o.issuer, f.credentialRowId, { config: e.eip, now });
  const signature = await o.wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
  const accepted = await acceptCredentialSignature(tx, o.issuer, f.credentialRowId, { signature, issuedAt: prep.issuedAt, nonce: prep.nonce }, { config: e.eip, now, chain: e.reader });
  return { prep, accepted, now };
}

describe("journey: deploy -> register -> authorise -> sign -> seal -> anchor -> finalise -> ANCHORED", () => {
  it("runs end to end on a real local chain, and positive evidence appears only at finality", async () => {
    const e = env();
    const r = await inRollback(async (tx) => {
      const o = await onboard(tx);

      // The organisation and its issuer key exist only because the chain said so, at FINALIZED.
      const key = await tx.issuerKey.findUniqueOrThrow({ where: { id: o.key.id }, include: { authoriseTransaction: true } });

      const f = await approvedCredential(tx, PERMANENT, { orgId: o.org.id, issuer: o.issuer });
      const { accepted, now } = await signOnChain(tx, o, f);
      const sealed = await sealCohortBatch(tx, o.issuer, { now });

      // Build -> the issuer's wallet broadcasts -> the server records the hash.
      const anchor = await buildSendRecord(tx, o.issuer, o.wallet, "ANCHOR_COHORT", sealed.batchId, {}, now);
      const rowPending = await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: anchor.rec.id } });

      // Mined but not final: CONFIRMED, and still NO anchor / ANCHORED credential.
      const confirmed = await sync(tx, anchor.rec.id);
      const mid = {
        tx: confirmed.status,
        anchors: await tx.anchor.count({ where: { organisationId: o.org.id } }),
        cred: (await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } })).pipelineStatus,
        batch: (await tx.cohortBatch.findUniqueOrThrow({ where: { id: sealed.batchId } })).status,
      };

      // Finality (2 blocks): FINALIZED + mirror.
      const done = await finalise(tx, anchor.rec.id);
      const row = await tx.anchor.findFirstOrThrow({ where: { organisationId: o.org.id } });
      const proof = await getCohortProof(tx, o.issuer, f.credentialRowId);
      const onChain = await e.registry.getAnchor(row.chainRoot);
      const included = await e.registry.verifyCohortInclusion(row.chainRoot, proof.leafHash, proof.proof!.siblings);
      return {
        o,
        key,
        accepted,
        sealed,
        rowPending,
        mid,
        done,
        row,
        proof,
        onChain,
        included,
        after: {
          cred: (await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } })).pipelineStatus,
          batch: await tx.cohortBatch.findUniqueOrThrow({ where: { id: sealed.batchId } }),
          txRow: await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: anchor.rec.id } }),
        },
      };
    });

    expect(r.o.org.status).toBe("ACTIVE");
    expect(r.key.authoriseTransaction?.status).toBe("FINALIZED");
    expect(r.key.operatorMemberId).toBe(r.o.issuer.memberId); // wallet proof of possession
    expect(r.accepted).toMatchObject({ pipelineStatus: "QUEUED_FOR_ANCHOR", queued: true });
    expect(r.rowPending).toMatchObject({ status: "PENDING", purpose: "ANCHOR_COHORT", fromAddress: r.o.wallet.address.toLowerCase() });
    expect(r.rowPending.txNonce).not.toBeNull();

    expect(r.mid).toEqual({ tx: "CONFIRMED", anchors: 0, cred: "QUEUED_FOR_ANCHOR", batch: "SEALED" });

    expect(r.done.status).toBe("FINALIZED");
    expect(r.row).toMatchObject({ attestationType: "COHORT", epoch: 1, batchRoot: r.sealed.batchRoot, previousChainRoot: ZERO_HASH, leafCount: 1, transactionId: r.after.txRow.id });
    expect(r.row.chainRoot).toBe(chainRootOf(r.sealed.batchRoot, ZERO_HASH, r.o.org.orgId, "COHORT", 1n)); // TS == Solidity on a real chain
    expect(r.onChain.anchoredBy.toLowerCase()).toBe(r.o.wallet.address.toLowerCase());
    expect(r.included).toBe(true); // the contract itself verifies the stored CohortProof
    expect(verifyCohortProof(r.sealed.batchRoot, r.proof.leafHash, r.proof.proof!)).toBe(true);
    expect(r.after.cred).toBe("ANCHORED");
    expect(r.after.batch).toMatchObject({ status: "ANCHORED", anchorId: r.row.id });
    expect(r.after.txRow).toMatchObject({ status: "FINALIZED" });
    expect(r.after.txRow.blockNumber).not.toBeNull();
  });

  it("a second batch continues the SAME COHORT chain (previousChainRoot = epoch 1)", async () => {
    const e = env();
    const r = await inRollback(async (tx) => {
      const o = await onboard(tx);
      const anchorOne = async () => {
        const f = await approvedCredential(tx, PERMANENT, { orgId: o.org.id, issuer: o.issuer });
        const { now } = await signOnChain(tx, o, f);
        const sealed = await sealCohortBatch(tx, o.issuer, { now });
        const a = await buildSendRecord(tx, o.issuer, o.wallet, "ANCHOR_COHORT", sealed.batchId, {}, now);
        await finalise(tx, a.rec.id);
        return sealed;
      };
      const first = await anchorOne();
      const second = await anchorOne();
      const anchors = await tx.anchor.findMany({ where: { organisationId: o.org.id }, orderBy: { epoch: "asc" } });
      return { o, first, second, anchors, head: await e.reader.getChainHead(o.org.orgId, "COHORT") };
    });
    expect(r.anchors.map((a) => a.epoch)).toEqual([1, 2]);
    expect(r.anchors[1].previousChainRoot).toBe(r.anchors[0].chainRoot);
    expect(r.anchors[1].chainRoot).toBe(chainRootOf(r.second.batchRoot, r.anchors[0].chainRoot, r.o.org.orgId, "COHORT", 2n));
    expect(r.head).toEqual({ chainRoot: r.anchors[1].chainRoot, epoch: 2n });
  });
});

describe("journey: CONTINUING -> ProofPulse -> anchor -> END -> new epoch", () => {
  it("anchors the current root, ends the relationship (not a revocation) and anchors the next epoch", async () => {
    const e = env();
    const r = await inRollback(async (tx) => {
      const o = await onboard(tx);
      const f = await approvedCredential(tx, CONTINUING, { orgId: o.org.id, issuer: o.issuer });
      const { now, accepted } = await signOnChain(tx, o, f);
      const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: o.org.id } });

      // Epoch 1 snapshots the already-current root (rootSeq 1).
      const a1 = await buildSendRecord(tx, o.issuer, o.wallet, "ANCHOR_PROOF_PULSE", tree.id, {}, now);
      await finalise(tx, a1.rec.id);
      const epoch1 = await tx.anchor.findFirstOrThrow({ where: { organisationId: o.org.id, attestationType: "PROOF_PULSE" } });
      const afterFirst = (await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } })).pipelineStatus;

      // The employee leaves: the issuer signs ENDED with the real wallet; the leaf changes in place.
      const endClock = await signingClock(10);
      const effectiveAt = new Date(Math.floor(endClock.getTime() / 1000 - 3600) * 1000);
      const prep = await prepareEndRelationship(tx, o.issuer, f.credentialRowId, { effectiveAt }, { config: e.eip, now: endClock });
      const signature = await o.wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
      const ended = await acceptStatusChange(tx, o.issuer, f.credentialRowId, { signature, issuedAt: prep.issuedAt, effectiveAt: prep.effectiveAt, nonce: prep.nonce }, { config: e.eip, now: endClock, chain: e.reader });

      // Epoch 2 snapshots the NEW root: nothing was rebuilt, only one path changed.
      const a2 = await buildSendRecord(tx, o.issuer, o.wallet, "ANCHOR_PROOF_PULSE", tree.id, {}, endClock);
      await finalise(tx, a2.rec.id);
      const anchors = await tx.anchor.findMany({ where: { organisationId: o.org.id, attestationType: "PROOF_PULSE" }, orderBy: { epoch: "asc" } });
      const current = await getPulseProof(tx, o.issuer, f.credentialRowId);
      const old = await getHistoricalPulseProof(tx, o.issuer, f.credentialRowId, 1);
      return {
        o,
        accepted,
        epoch1,
        afterFirst,
        ended,
        anchors,
        current,
        old,
        onChainHead: await e.reader.getChainHead(o.org.orgId, "PROOF_PULSE"),
        lastSeq: await e.reader.getLastPulseRootSeq(o.org.orgId),
        credential: await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } }),
        revocations: await tx.revocation.count({ where: { organisationId: o.org.id } }),
        credentials: await tx.credential.count({ where: { organisationId: o.org.id } }),
      };
    });
    expect(r.accepted.pipelineStatus).toBe("QUEUED_FOR_ANCHOR");
    expect(r.epoch1).toMatchObject({ epoch: 1, rootSeq: 1, leafCount: 1, previousChainRoot: ZERO_HASH });
    expect(r.afterFirst).toBe("ANCHORED");
    expect(r.ended).toMatchObject({ statusSeq: 2, idempotent: false, rootSeq: 2 });

    expect(r.anchors.map((a) => [a.epoch, a.rootSeq])).toEqual([[1, 1], [2, 2]]);
    expect(r.anchors[1].previousChainRoot).toBe(r.anchors[0].chainRoot);
    expect(r.anchors[0].batchRoot).not.toBe(r.anchors[1].batchRoot); // the END produced a new root
    expect(r.onChainHead).toEqual({ chainRoot: r.anchors[1].chainRoot, epoch: 2n });
    expect(r.lastSeq).toBe(2n);

    // Both roots stay provable: ACTIVE at epoch 1's root, ENDED at epoch 2's root.
    expect(r.old.root).toBe(r.anchors[0].batchRoot);
    expect(verifyPulseProof(r.anchors[0].batchRoot, r.old.depth, r.old.leafIndex, r.old.leafHash, r.old.siblings)).toBe(true);
    expect(r.current.root).toBe(r.anchors[1].batchRoot);
    expect(verifyPulseProof(r.anchors[1].batchRoot, r.current.depth, r.current.leafIndex, r.current.leafHash, r.current.siblings)).toBe(true);
    expect(r.old.leafHash).not.toBe(r.current.leafHash);

    // ENDED is not REVOKED: no Revocation, the same single Credential, still CONTINUING.
    expect(r.revocations).toBe(0);
    expect(r.credentials).toBe(1);
    expect(r.credential.lifecycleType).toBe("CONTINUING");
    expect(r.credential.pipelineStatus).toBe("ANCHORED");
  });

  it("a re-affirming epoch with an unchanged root is accepted by the contract (nothing is rebuilt)", async () => {
    const e = env();
    const r = await inRollback(async (tx) => {
      const o = await onboard(tx);
      const f = await approvedCredential(tx, CONTINUING, { orgId: o.org.id, issuer: o.issuer });
      const { now } = await signOnChain(tx, o, f);
      const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: o.org.id } });
      const a1 = await buildSendRecord(tx, o.issuer, o.wallet, "ANCHOR_PROOF_PULSE", tree.id, {}, now);
      await finalise(tx, a1.rec.id);
      const a2 = await buildSendRecord(tx, o.issuer, o.wallet, "ANCHOR_PROOF_PULSE", tree.id, {}, now);
      await finalise(tx, a2.rec.id);
      return { anchors: await tx.anchor.findMany({ where: { organisationId: o.org.id }, orderBy: { epoch: "asc" } }), updates: await tx.proofPulseUpdate.count({ where: { treeId: tree.id } }), head: await e.reader.getChainHead(o.org.orgId, "PROOF_PULSE") };
    });
    expect(r.anchors.map((a) => [a.epoch, a.rootSeq, a.batchRoot === r.anchors[0].batchRoot])).toEqual([[1, 1, true], [2, 1, true]]);
    expect(r.updates).toBe(1); // anchoring performed no tree work
    expect(r.head.epoch).toBe(2n);
  });
});

