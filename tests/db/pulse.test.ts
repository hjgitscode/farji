import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/authorize";
import { PULSE_STATUS_CODE, SCOPE_CODE } from "@/lib/crypto/constants";
import { dateToUnixSeconds } from "@/lib/crypto/encoding";
import { emptyPulseRoot, pulseLeafHash, SparsePulseTree, verifyPulseProof } from "@/lib/merkle/pulse";
import { acceptStatusChange, prepareEndRelationship } from "@/server/issuance/status-change";
import { enqueuePendingForOrganisation } from "@/server/merkle/enqueue";
import { applyPulseStatusChange, commitPathUpdate, getHistoricalPulseProof, getPulseProof } from "@/server/merkle/pulse";
import { TEST_CONFIG, freshWallet, type TestWallet } from "../fixtures/test-wallets";
import { db, inRollback, mkOrg, type Tx } from "./helpers";
import { addKey, approvedCredential, CONTINUING, issuerOf, PERMANENT, signCredential, SIGN_NOW, type Fixture } from "./issuance-helpers";

afterAll(async () => {
  await db.$disconnect();
});

const END_NOW = new Date("2026-10-20T10:00:00Z");
const END_AT = new Date("2026-10-19T00:00:00Z");
const DEPTH = 20;

const caught = (p: Promise<unknown>) => p.then(() => null, (e) => e);

async function org(tx: Tx) {
  const o = await mkOrg(tx, "ACTIVE");
  const issuer = await issuerOf(tx, o.id);
  const wallet = freshWallet();
  await addKey(tx, o.id, wallet);
  return { orgId: o.id, issuer, wallet };
}
type Ctx = Awaited<ReturnType<typeof org>>;

/** Approve, sign and (by default) insert a CONTINUING credential into the organisation's tree. */
async function signedContinuing(tx: Tx, ctx: Ctx, draft: Record<string, unknown> = CONTINUING, enqueue = true): Promise<Fixture> {
  const f = await approvedCredential(tx, draft, { orgId: ctx.orgId, issuer: ctx.issuer });
  await signCredential(tx, f, ctx.wallet, { enqueue });
  return f;
}

async function endRelationship(tx: Tx, ctx: Ctx, f: Pick<Fixture, "credentialRowId">, over: { effectiveAt?: Date; now?: Date; wallet?: TestWallet; issuer?: Actor } = {}) {
  const now = over.now ?? END_NOW;
  const issuer = over.issuer ?? ctx.issuer;
  const prep = await prepareEndRelationship(tx, issuer, f.credentialRowId, { effectiveAt: over.effectiveAt ?? END_AT }, { config: TEST_CONFIG, now: END_NOW });
  const signature = await (over.wallet ?? ctx.wallet).signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
  const accepted = await acceptStatusChange(
    tx,
    issuer,
    f.credentialRowId,
    { signature, issuedAt: prep.issuedAt, effectiveAt: prep.effectiveAt, nonce: prep.nonce },
    { config: TEST_CONFIG, now },
  );
  return { prep, signature, accepted };
}

/** Recomputes a leaf hash purely from stored evidence (credential row + leaf row). */
async function leafHashFromEvidence(tx: Tx, credentialRowId: string): Promise<string> {
  const leaf = await tx.proofPulseLeaf.findFirstOrThrow({ where: { credentialRowId } });
  const c = await tx.credential.findUniqueOrThrow({ where: { id: credentialRowId }, include: { organisation: true } });
  return pulseLeafHash({
    orgId: c.organisation.orgId,
    leafIndex: leaf.leafIndex,
    credentialId: c.credentialId!,
    subjectCommitment: c.subjectCommitment!,
    contentDigest: c.contentDigest!,
    scope: SCOPE_CODE[leaf.scope],
    status: PULSE_STATUS_CODE[leaf.status],
    statusEffectiveAt: dateToUnixSeconds(leaf.statusEffectiveAt),
    statusSeq: leaf.statusSeq,
  });
}

const nodeSnapshot = async (tx: Tx, treeId: string) =>
  new Map((await tx.proofPulseNode.findMany({ where: { treeId } })).map((n) => [`${n.level}:${n.position}`, n.hash]));

describe("tree initialisation and insertion", () => {
  it("the first CONTINUING credential creates the tree at the zero root and takes leaf index 0", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const before = await tx.proofPulseTree.count({ where: { organisationId: ctx.orgId } });
      const f = await signedContinuing(tx, ctx);
      const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
      return {
        before,
        f,
        tree,
        leaf: await tx.proofPulseLeaf.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } }),
        updates: await tx.proofPulseUpdate.findMany({ where: { treeId: tree.id }, orderBy: { rootSeq: "asc" } }),
        nodes: await tx.proofPulseNode.count({ where: { treeId: tree.id } }),
        c: await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } }),
        att: await tx.attestation.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } }),
        hashFromEvidence: await leafHashFromEvidence(tx, f.credentialRowId),
        audits: await tx.auditEvent.findMany({ where: { targetId: f.credentialRowId, action: "PULSE_LEAF_INSERTED" } }),
      };
    });
    expect(r.before).toBe(0); // no tree until a CONTINUING credential needs one
    expect(r.tree).toMatchObject({ depth: DEPTH, currentRootSeq: 1, nextLeafIndex: 1 });
    expect(r.leaf).toMatchObject({ leafIndex: 0, status: "ACTIVE", statusSeq: 1, scope: "EMPLOYMENT" });
    expect(r.leaf.statusEffectiveAt.toISOString()).toBe("2022-01-10T00:00:00.000Z"); // the claim's start (validFrom), not the signing time
    expect(r.leaf.leafHash).toBe(r.hashFromEvidence);
    // History: the first update starts from the empty (all-zero-subtree) root.
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0]).toMatchObject({ rootSeq: 1, kind: "INSERT", leafIndex: 0, previousRoot: emptyPulseRoot(DEPTH), newRoot: r.tree.currentRoot, newLeafHash: r.leaf.leafHash });
    expect(r.updates[0].causedByAttestationId).toBe(r.att.id);
    expect(r.nodes).toBe(DEPTH + 1); // the leaf and its `depth` ancestors, nothing else
    expect(r.c.pipelineStatus).toBe("QUEUED_FOR_ANCHOR");
    expect(r.audits).toHaveLength(1);
    // The stored root equals an independent from-scratch computation.
    const reference = new SparsePulseTree(DEPTH);
    expect(reference.setLeaf(0, r.leaf.leafHash!)).toBe(r.tree.currentRoot);
  });

  it("a second credential takes index 1, adds one leaf node and bumps rootSeq", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f1 = await signedContinuing(tx, ctx);
      const f2 = await signedContinuing(tx, ctx);
      const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
      return {
        tree,
        l1: await tx.proofPulseLeaf.findFirstOrThrow({ where: { credentialRowId: f1.credentialRowId } }),
        l2: await tx.proofPulseLeaf.findFirstOrThrow({ where: { credentialRowId: f2.credentialRowId } }),
        updates: await tx.proofPulseUpdate.findMany({ where: { treeId: tree.id }, orderBy: { rootSeq: "asc" } }),
        nodes: await tx.proofPulseNode.count({ where: { treeId: tree.id } }),
      };
    });
    expect([r.l1.leafIndex, r.l2.leafIndex]).toEqual([0, 1]);
    expect(r.tree).toMatchObject({ currentRootSeq: 2, nextLeafIndex: 2 });
    expect(r.updates.map((u) => [u.rootSeq, u.leafIndex, u.kind])).toEqual([[1, 0, "INSERT"], [2, 1, "INSERT"]]);
    expect(r.updates[1].previousRoot).toBe(r.updates[0].newRoot);
    expect(r.nodes).toBe(DEPTH + 2); // siblings share every ancestor above level 0
    const reference = new SparsePulseTree(DEPTH);
    reference.setLeaf(0, r.l1.leafHash!);
    expect(reference.setLeaf(1, r.l2.leafHash!)).toBe(r.tree.currentRoot);
  });

  it("only CONTINUING credentials enter the tree: PERMANENT goes to CohortProof", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      await signedContinuing(tx, ctx, PERMANENT);
      return { trees: await tx.proofPulseTree.count({ where: { organisationId: ctx.orgId } }), leaves: await tx.proofPulseLeaf.count({ where: { organisationId: ctx.orgId } }) };
    });
    expect(r).toEqual({ trees: 0, leaves: 0 });
    // ...and the database refuses a pulse leaf for a non-CONTINUING credential.
  });

  it("the database refuses a ProofPulse leaf for a PERMANENT credential", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        const f = await signedContinuing(tx, ctx, PERMANENT, false);
        const tree = await tx.proofPulseTree.create({ data: { organisationId: ctx.orgId } });
        await tx.proofPulseLeaf.create({
          data: { treeId: tree.id, organisationId: ctx.orgId, credentialRowId: f.credentialRowId, leafIndex: 0, scope: "EMPLOYMENT", statusEffectiveAt: new Date() },
        });
      }),
    ).rejects.toThrow(/CONTINUING/);
  });

  it("scope follows the claim category", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const exp = await signedContinuing(tx, ctx, CONTINUING);
      const edu = await signedContinuing(tx, ctx, { ...CONTINUING, category: "EDUCATION", fieldOfStudy: "CS" });
      const mem = await signedContinuing(tx, ctx, { ...CONTINUING, category: "MEMBERSHIP" });
      const cert = await signedContinuing(tx, ctx, { ...CONTINUING, category: "CERTIFICATION", credentialNumber: "X1" });
      const scopeOf = async (f: Fixture) => (await tx.proofPulseLeaf.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } })).scope;
      return [await scopeOf(exp), await scopeOf(edu), await scopeOf(mem), await scopeOf(cert)];
    });
    expect(r).toEqual(["EMPLOYMENT", "ENROLMENT", "MEMBERSHIP", "MEMBERSHIP"]);
  });

  it("enqueueing again is idempotent (no second leaf, no new root)", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      await signedContinuing(tx, ctx);
      const before = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
      const sweep = await enqueuePendingForOrganisation(tx, ctx.issuer, { now: SIGN_NOW });
      const after = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
      return { before, after, sweep, leaves: await tx.proofPulseLeaf.count({ where: { organisationId: ctx.orgId } }) };
    });
    expect(r.sweep).toEqual([]); // nothing left in SIGNED
    expect(r.after).toEqual(r.before);
    expect(r.leaves).toBe(1);
  });
});

describe("ACTIVE -> ENDED", () => {
  it("ends one leaf in place: same index, statusSeq 2, new path, rootSeq +1, history retained", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f0 = await signedContinuing(tx, ctx);
      const f1 = await signedContinuing(tx, ctx);
      const f2 = await signedContinuing(tx, ctx);
      const treeBefore = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
      const nodesBefore = await nodeSnapshot(tx, treeBefore.id);
      const leavesBefore = await tx.proofPulseLeaf.findMany({ where: { treeId: treeBefore.id }, orderBy: { leafIndex: "asc" } });

      const end = await endRelationship(tx, ctx, f0);

      const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
      return {
        f0,
        f1,
        f2,
        end,
        treeBefore,
        tree,
        nodesBefore,
        nodesAfter: await nodeSnapshot(tx, tree.id),
        leavesBefore,
        leavesAfter: await tx.proofPulseLeaf.findMany({ where: { treeId: tree.id }, orderBy: { leafIndex: "asc" } }),
        updates: await tx.proofPulseUpdate.findMany({ where: { treeId: tree.id }, orderBy: { rootSeq: "asc" } }),
        att: await tx.attestation.findFirstOrThrow({ where: { credentialRowId: f0.credentialRowId, kind: "STATUS_CHANGE" } }),
        hashFromEvidence: await leafHashFromEvidence(tx, f0.credentialRowId),
        audits: await tx.auditEvent.findMany({ where: { targetId: f0.credentialRowId, action: { in: ["STATUS_CHANGE_ACCEPTED", "PULSE_LEAF_ENDED"] } } }),
      };
    });

    // The leaf: same index, ENDED, next statusSeq, effective date from the signed message.
    const ended = r.leavesAfter[0];
    expect(ended).toMatchObject({ leafIndex: 0, status: "ENDED", statusSeq: 2 });
    expect(ended.statusEffectiveAt.toISOString()).toBe(END_AT.toISOString());
    expect(ended.leafHash).toBe(r.hashFromEvidence);
    expect(ended.leafHash).not.toBe(r.leavesBefore[0].leafHash);

    // rootSeq +1 and a retained history row caused by the STATUS_CHANGE attestation.
    expect(r.tree.currentRootSeq).toBe(r.treeBefore.currentRootSeq + 1);
    expect(r.tree.currentRoot).not.toBe(r.treeBefore.currentRoot);
    expect(r.tree.nextLeafIndex).toBe(r.treeBefore.nextLeafIndex);
    expect(r.updates).toHaveLength(4);
    expect(r.updates[3]).toMatchObject({ rootSeq: 4, kind: "STATUS_CHANGE", leafIndex: 0, previousRoot: r.treeBefore.currentRoot, newRoot: r.tree.currentRoot });
    expect(r.updates[3].causedByAttestationId).toBe(r.att.id);
    expect(r.att).toMatchObject({ kind: "STATUS_CHANGE", statusSeq: 2, newStatus: "ENDED" });
    expect(r.att.effectiveAt?.toISOString()).toBe(END_AT.toISOString());
    expect(r.end.accepted).toMatchObject({ statusSeq: 2, leafIndex: 0, idempotent: false, rootSeq: 4 });

    // Only the path changed: leaf 0 and its ancestors (depth + 1 nodes); every other node is identical.
    const changed = [...r.nodesAfter].filter(([k, h]) => r.nodesBefore.get(k) !== h).map(([k]) => k);
    expect(changed).toHaveLength(DEPTH + 1);
    for (const k of changed) {
      const [level, position] = k.split(":").map(Number);
      expect(position).toBe(0); // leaf 0's path is position 0 at every level
      expect(level).toBeGreaterThanOrEqual(0);
    }
    expect(r.nodesAfter.size).toBe(r.nodesBefore.size);
    // Untouched leaves keep their stored values.
    expect(r.leavesAfter[1]).toEqual(r.leavesBefore[1]);
    expect(r.leavesAfter[2]).toEqual(r.leavesBefore[2]);
    expect(r.nodesAfter.get("0:1")).toBe(r.leavesBefore[1].leafHash);
    expect(r.nodesAfter.get("0:2")).toBe(r.leavesBefore[2].leafHash);
    expect(r.audits.map((a) => a.action).sort()).toEqual(["PULSE_LEAF_ENDED", "STATUS_CHANGE_ACCEPTED"]);
  });

  it("the index is stable and never reused: a later credential gets the next free index", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f0 = await signedContinuing(tx, ctx);
      await signedContinuing(tx, ctx);
      await endRelationship(tx, ctx, f0);
      const f2 = await signedContinuing(tx, ctx);
      return {
        l0: await tx.proofPulseLeaf.findFirstOrThrow({ where: { credentialRowId: f0.credentialRowId } }),
        l2: await tx.proofPulseLeaf.findFirstOrThrow({ where: { credentialRowId: f2.credentialRowId } }),
        tree: await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } }),
      };
    });
    expect(r.l0).toMatchObject({ leafIndex: 0, status: "ENDED" });
    expect(r.l2.leafIndex).toBe(2);
    expect(r.tree.nextLeafIndex).toBe(3);
  });

  it("ENDED is not revocation: no Revocation, no new Credential, nothing deleted, pipeline unchanged", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signedContinuing(tx, ctx);
      const before = await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } });
      await endRelationship(tx, ctx, f);
      return {
        before,
        after: await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } }),
        revocations: await tx.revocation.count({ where: { organisationId: ctx.orgId } }),
        credentialsForVersion: await tx.credential.count({ where: { claimVersionId: f.claimVersionId } }),
        credentialsForOrg: await tx.credential.count({ where: { organisationId: ctx.orgId } }),
        cohortLeaves: await tx.cohortLeaf.count({ where: { organisationId: ctx.orgId } }),
        transactions: await tx.blockchainTransaction.count({ where: { organisationId: ctx.orgId } }),
        anchors: await tx.anchor.count({ where: { organisationId: ctx.orgId } }),
      };
    });
    expect(r.revocations).toBe(0);
    expect(r.credentialsForVersion).toBe(1);
    expect(r.credentialsForOrg).toBe(1); // no second PERMANENT credential
    expect(r.after).toEqual(r.before); // the Credential row is untouched
    expect(r.after.lifecycleType).toBe("CONTINUING");
    expect(r.cohortLeaves).toBe(0);
    expect(r.transactions + r.anchors).toBe(0);
  });

  it("an ENDED leaf cannot go back to ACTIVE, and statusSeq cannot decrease (database triggers)", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        const f = await signedContinuing(tx, ctx);
        await endRelationship(tx, ctx, f);
        await tx.proofPulseLeaf.updateMany({ where: { credentialRowId: f.credentialRowId }, data: { status: "ACTIVE" } });
      }),
    ).rejects.toThrow(/ENDED/);

    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        const f = await signedContinuing(tx, ctx);
        await endRelationship(tx, ctx, f);
        await tx.proofPulseLeaf.updateMany({ where: { credentialRowId: f.credentialRowId }, data: { status: "ENDED", statusSeq: 1 } });
      }),
    ).rejects.toThrow(/statusSeq/);
  });

  it("the leaf index is immutable", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        const f = await signedContinuing(tx, ctx);
        await tx.proofPulseLeaf.updateMany({ where: { credentialRowId: f.credentialRowId }, data: { leafIndex: 5 } });
      }),
    ).rejects.toThrow(/immutable/);
  });
});

describe("statusSeq replay and rollback protection", () => {
  it("replaying the accepted status change is idempotent; any other message for an ended leaf is a CONFLICT", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signedContinuing(tx, ctx);
      const first = await endRelationship(tx, ctx, f);
      const input = { signature: first.signature, issuedAt: first.prep.issuedAt, effectiveAt: first.prep.effectiveAt, nonce: first.prep.nonce };
      const replay = await acceptStatusChange(tx, ctx.issuer, f.credentialRowId, input, { config: TEST_CONFIG, now: END_NOW });

      // A fresh, validly signed message with a new nonce, replayed against the ended leaf.
      const td = first.prep.typedData;
      const nonce = "0x" + "cd".repeat(32);
      const sig2 = await ctx.wallet.signTypedData(td.domain, td.types, { ...td.message, nonce });
      const other = await caught(acceptStatusChange(tx, ctx.issuer, f.credentialRowId, { ...input, signature: sig2, nonce }, { config: TEST_CONFIG, now: END_NOW }));
      const prepAgain = await caught(prepareEndRelationship(tx, ctx.issuer, f.credentialRowId, { effectiveAt: END_AT }, { config: TEST_CONFIG, now: END_NOW }));
      return {
        first,
        replay,
        other,
        prepAgain,
        atts: await tx.attestation.count({ where: { credentialRowId: f.credentialRowId, kind: "STATUS_CHANGE" } }),
        updates: await tx.proofPulseUpdate.count({ where: { tree: { organisationId: ctx.orgId } } }),
      };
    });
    expect(r.replay).toMatchObject({ idempotent: true, attestationId: r.first.accepted.attestationId, statusSeq: 2 });
    expect(r.other).toMatchObject({ code: "CONFLICT" });
    expect(r.prepAgain).toMatchObject({ code: "CONFLICT" });
    expect(r.atts).toBe(1);
    expect(r.updates).toBe(2); // INSERT + one STATUS_CHANGE, never a third
  });

  it("applyPulseStatusChange refuses any statusSeq other than current + 1", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signedContinuing(tx, ctx);
      const att = await tx.attestation.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } });
      const scope = { userId: ctx.issuer.userId, organisationId: ctx.orgId, memberId: ctx.issuer.memberId! };
      const errs = [];
      for (const statusSeq of [1, 3, 99]) {
        errs.push(await caught(applyPulseStatusChange(tx, scope, f.credentialRowId, { attestationId: att.id, effectiveAt: 1760000000n, statusSeq }, END_NOW)));
      }
      return { errs, leaf: await tx.proofPulseLeaf.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } }) };
    });
    for (const e of r.errs) expect(e).toMatchObject({ code: "CONFLICT" });
    expect(r.leaf).toMatchObject({ status: "ACTIVE", statusSeq: 1 });
  });

  it("two STATUS_CHANGE attestations for the same statusSeq cannot both be stored", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        const f = await signedContinuing(tx, ctx);
        await endRelationship(tx, ctx, f);
        const att = await tx.attestation.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId, kind: "STATUS_CHANGE" } });
        // Same credential and statusSeq, different hash/nonce: the partial unique index refuses it.
        await tx.attestation.create({
          data: {
            kind: att.kind,
            credentialRowId: att.credentialRowId,
            organisationId: att.organisationId,
            signerKeyId: att.signerKeyId,
            typedDataHash: "0x" + "ab".repeat(32),
            signature: att.signature,
            nonce: "0x" + "cd".repeat(32),
            issuedAt: att.issuedAt,
            chainId: att.chainId,
            verifyingContract: att.verifyingContract,
            statusSeq: att.statusSeq,
            newStatus: att.newStatus,
            effectiveAt: att.effectiveAt,
          },
        });
      }),
    ).rejects.toThrow();
  });

  it("the update history is append-only", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        await signedContinuing(tx, ctx);
        const u = await tx.proofPulseUpdate.findFirstOrThrow({ where: { tree: { organisationId: ctx.orgId } } });
        await tx.proofPulseUpdate.update({ where: { id: u.id }, data: { newRoot: "0x" + "ab".repeat(32) } });
      }),
    ).rejects.toThrow(/append-only/);

    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        await signedContinuing(tx, ctx);
        const u = await tx.proofPulseUpdate.findFirstOrThrow({ where: { tree: { organisationId: ctx.orgId } } });
        await tx.proofPulseUpdate.delete({ where: { id: u.id } });
      }),
    ).rejects.toThrow(/append-only/);
  });
});

describe("status-change authorisation and validation", () => {
  it("only an authorised wallet of the organisation can end a relationship", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signedContinuing(tx, ctx);
      const stranger = freshWallet();
      const bad = await caught(endRelationship(tx, ctx, f, { wallet: stranger }));
      const other = await org(tx);
      const otherWallet = other.wallet;
      const crossWallet = await caught(endRelationship(tx, ctx, f, { wallet: otherWallet })); // key belongs to ANOTHER organisation
      return { bad, crossWallet, leaf: await tx.proofPulseLeaf.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } }) };
    });
    expect(r.bad).toMatchObject({ code: "FORBIDDEN" });
    expect(r.crossWallet).toMatchObject({ code: "FORBIDDEN" });
    expect(r.leaf.status).toBe("ACTIVE");
  });

  it("another organisation's issuer and non-issuers are refused", async () => {
    const r = await inRollback(async (tx) => {
      const a = await org(tx);
      const f = await signedContinuing(tx, a);
      const b = await org(tx);
      return {
        cross: await caught(prepareEndRelationship(tx, b.issuer, f.credentialRowId, { effectiveAt: END_AT }, { config: TEST_CONFIG, now: END_NOW })),
        candidate: await caught(prepareEndRelationship(tx, { ...a.issuer, role: "CANDIDATE" }, f.credentialRowId, { effectiveAt: END_AT }, { config: TEST_CONFIG, now: END_NOW })),
        admin: await caught(prepareEndRelationship(tx, { ...a.issuer, role: "ADMIN" }, f.credentialRowId, { effectiveAt: END_AT }, { config: TEST_CONFIG, now: END_NOW })),
      };
    });
    expect(r.cross).toMatchObject({ code: "NOT_FOUND" });
    expect(r.candidate).toMatchObject({ code: "FORBIDDEN" });
    expect(r.admin).toMatchObject({ code: "FORBIDDEN" });
  });

  it("the end date must lie between the start of the record and now", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signedContinuing(tx, ctx);
      const prep = (effectiveAt: Date) => caught(prepareEndRelationship(tx, ctx.issuer, f.credentialRowId, { effectiveAt }, { config: TEST_CONFIG, now: END_NOW }));
      return {
        beforeStart: await prep(new Date("2021-12-31T00:00:00Z")),
        future: await prep(new Date("2026-10-21T00:00:00Z")),
        fractional: await prep(new Date("2026-10-19T00:00:00.500Z")),
        invalid: await prep(new Date("nope")),
      };
    });
    for (const e of Object.values(r)) expect(e).toMatchObject({ code: "VALIDATION" });
  });

  it("only a CONTINUING credential can end", async () => {
    const err = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signedContinuing(tx, ctx, PERMANENT);
      return caught(prepareEndRelationship(tx, ctx.issuer, f.credentialRowId, { effectiveAt: END_AT }, { config: TEST_CONFIG, now: END_NOW }));
    });
    expect(err).toMatchObject({ code: "CONFLICT" });
  });

  it("a stale status-change signature is refused", async () => {
    const err = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signedContinuing(tx, ctx);
      const prep = await prepareEndRelationship(tx, ctx.issuer, f.credentialRowId, { effectiveAt: END_AT }, { config: TEST_CONFIG, now: END_NOW });
      const signature = await ctx.wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
      return caught(
        acceptStatusChange(tx, ctx.issuer, f.credentialRowId, { signature, issuedAt: prep.issuedAt, effectiveAt: prep.effectiveAt, nonce: prep.nonce }, { config: TEST_CONFIG, now: new Date(END_NOW.getTime() + 15 * 60_000) }),
      );
    });
    expect(err).toMatchObject({ code: "VALIDATION" });
  });
});

describe("proofs", () => {
  it("the current proof verifies against the current root", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const fs = [await signedContinuing(tx, ctx), await signedContinuing(tx, ctx), await signedContinuing(tx, ctx)];
      const proofs = await Promise.all(fs.map((f) => getPulseProof(tx, ctx.issuer, f.credentialRowId)));
      return { proofs, tree: await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } }) };
    });
    expect(r.proofs.map((p) => p.leafIndex)).toEqual([0, 1, 2]);
    for (const p of r.proofs) {
      expect(p.root).toBe(r.tree.currentRoot);
      expect(p.rootSeq).toBe(3);
      expect(p.siblings).toHaveLength(DEPTH);
      expect(verifyPulseProof(p.root, p.depth, p.leafIndex, p.leafHash, p.siblings)).toBe(true);
    }
  });

  it("a stale proof fails against the newer root but still verifies against its own", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f0 = await signedContinuing(tx, ctx);
      const f1 = await signedContinuing(tx, ctx);
      const oldProof = await getPulseProof(tx, ctx.issuer, f1.credentialRowId);
      await endRelationship(tx, ctx, f0); // leaf 0 is leaf 1's sibling, so leaf 1's proof changes
      const newProof = await getPulseProof(tx, ctx.issuer, f1.credentialRowId);
      return { oldProof, newProof };
    });
    const { oldProof, newProof } = r;
    expect(verifyPulseProof(oldProof.root, DEPTH, 1, oldProof.leafHash, oldProof.siblings)).toBe(true);
    expect(verifyPulseProof(newProof.root, DEPTH, 1, oldProof.leafHash, oldProof.siblings)).toBe(false);
    expect(verifyPulseProof(newProof.root, DEPTH, 1, newProof.leafHash, newProof.siblings)).toBe(true);
    expect(newProof.rootSeq).toBe(oldProof.rootSeq + 1);
    expect(newProof.leafHash).toBe(oldProof.leafHash); // leaf 1 itself never changed
  });

  it("historical replay: leaf 0 is provably ACTIVE at the old root and ENDED at the new one", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f0 = await signedContinuing(tx, ctx);
      const f1 = await signedContinuing(tx, ctx);
      const leafActive = await leafHashFromEvidence(tx, f0.credentialRowId);
      await endRelationship(tx, ctx, f0);
      const leafEnded = await leafHashFromEvidence(tx, f0.credentialRowId);
      const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
      const updates = await tx.proofPulseUpdate.findMany({ where: { treeId: tree.id }, orderBy: { rootSeq: "asc" } });
      return {
        leafActive,
        leafEnded,
        tree,
        updates,
        h2: await getHistoricalPulseProof(tx, ctx.issuer, f0.credentialRowId, 2),
        h3: await getHistoricalPulseProof(tx, ctx.issuer, f0.credentialRowId, 3),
        h1Leaf1: await caught(getHistoricalPulseProof(tx, ctx.issuer, f1.credentialRowId, 1)), // leaf 1 not yet inserted
        cur: await getPulseProof(tx, ctx.issuer, f0.credentialRowId),
        zero: await caught(getHistoricalPulseProof(tx, ctx.issuer, f0.credentialRowId, 0)),
        beyond: await caught(getHistoricalPulseProof(tx, ctx.issuer, f0.credentialRowId, 99)),
      };
    });
    // seq 2: leaf 0 ACTIVE under the old root.
    expect(r.h2.root).toBe(r.updates[1].newRoot);
    expect(r.h2.leafHash).toBe(r.leafActive);
    expect(verifyPulseProof(r.h2.root, DEPTH, 0, r.leafActive, r.h2.siblings)).toBe(true);
    // seq 3: leaf 0 ENDED under the new (current) root.
    expect(r.h3.root).toBe(r.tree.currentRoot);
    expect(r.h3.leafHash).toBe(r.leafEnded);
    expect(verifyPulseProof(r.h3.root, DEPTH, 0, r.leafEnded, r.h3.siblings)).toBe(true);
    expect(r.h3).toEqual({ ...r.cur, rootSeq: 3 });
    // The old ACTIVE evidence is NOT valid against the new root.
    expect(verifyPulseProof(r.h3.root, DEPTH, 0, r.leafActive, r.h2.siblings)).toBe(false);
    expect(r.h1Leaf1).toMatchObject({ code: "NOT_FOUND" });
    expect(r.zero).toMatchObject({ code: "NOT_FOUND" });
    expect(r.beyond).toMatchObject({ code: "NOT_FOUND" });
  });

  it("the stored root always equals a replay of the whole update log", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const fs = [await signedContinuing(tx, ctx), await signedContinuing(tx, ctx), await signedContinuing(tx, ctx)];
      await endRelationship(tx, ctx, fs[1]);
      const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
      return { tree, updates: await tx.proofPulseUpdate.findMany({ where: { treeId: tree.id }, orderBy: { rootSeq: "asc" } }) };
    });
    const reference = new SparsePulseTree(DEPTH);
    let root = emptyPulseRoot(DEPTH);
    for (const u of r.updates) root = reference.setLeaf(u.leafIndex, u.newLeafHash);
    expect(root).toBe(r.tree.currentRoot);
    expect(r.tree.currentRootSeq).toBe(r.updates.length);
    expect(r.updates.map((u) => u.rootSeq)).toEqual([1, 2, 3, 4]);
  });

  it("other organisations cannot read a proof", async () => {
    const r = await inRollback(async (tx) => {
      const a = await org(tx);
      const f = await signedContinuing(tx, a);
      const b = await org(tx);
      return {
        current: await caught(getPulseProof(tx, b.issuer, f.credentialRowId)),
        historical: await caught(getHistoricalPulseProof(tx, b.issuer, f.credentialRowId, 1)),
      };
    });
    expect(r.current).toMatchObject({ code: "NOT_FOUND" });
    expect(r.historical).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("concurrency and capacity", () => {
  it("a writer working from a stale snapshot (old currentRootSeq) is rejected and writes nothing", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f0 = await signedContinuing(tx, ctx);
      const stale = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
      await signedContinuing(tx, ctx); // advances the tree behind the stale snapshot's back
      const att = await tx.attestation.findFirstOrThrow({ where: { credentialRowId: f0.credentialRowId } });
      const nodesBefore = await tx.proofPulseNode.count({ where: { treeId: stale.id } });
      const updatesBefore = await tx.proofPulseUpdate.count({ where: { treeId: stale.id } });
      const err = await caught(commitPathUpdate(tx, stale, 5, "0x" + "ab".repeat(32), "INSERT", att.id, 6, END_NOW));
      const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { id: stale.id } });
      return {
        err,
        tree,
        stale,
        nodesDelta: (await tx.proofPulseNode.count({ where: { treeId: stale.id } })) - nodesBefore,
        updatesDelta: (await tx.proofPulseUpdate.count({ where: { treeId: stale.id } })) - updatesBefore,
      };
    });
    expect(r.err).toMatchObject({ code: "CONFLICT" });
    expect(r.tree.currentRootSeq).toBe(r.stale.currentRootSeq + 1); // unchanged by the rejected writer
    expect(r.nodesDelta).toBe(0);
    expect(r.updatesDelta).toBe(0);
  });

  it("the database refuses to roll the tree back or reuse a rootSeq", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        await signedContinuing(tx, ctx);
        await signedContinuing(tx, ctx);
        await tx.proofPulseTree.updateMany({ where: { organisationId: ctx.orgId }, data: { currentRootSeq: 1 } });
      }),
    ).rejects.toThrow(/may only increase/);

    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        const f = await signedContinuing(tx, ctx);
        const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
        const att = await tx.attestation.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } });
        await tx.proofPulseUpdate.create({
          data: { treeId: tree.id, rootSeq: 1, kind: "INSERT", leafIndex: 7, newLeafHash: "0x" + "ab".repeat(32), newRoot: "0x" + "cd".repeat(32), causedByAttestationId: att.id },
        });
      }),
    ).rejects.toThrow();
  });

  it("a full tree refuses a new leaf, writes nothing and leaves the credential SIGNED", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      // A deliberately tiny tree (depth 1 = capacity 2), created before the first insert.
      const tree = await tx.proofPulseTree.create({ data: { organisationId: ctx.orgId, depth: 1, currentRoot: emptyPulseRoot(1) } });
      const f0 = await signedContinuing(tx, ctx);
      const f1 = await signedContinuing(tx, ctx);
      const before = await tx.proofPulseTree.findUniqueOrThrow({ where: { id: tree.id } });

      const f2 = await approvedCredential(tx, CONTINUING, { orgId: ctx.orgId, issuer: ctx.issuer });
      const third = await signCredential(tx, f2, ctx.wallet, { enqueue: true });
      return {
        f0,
        f1,
        before,
        third,
        after: await tx.proofPulseTree.findUniqueOrThrow({ where: { id: tree.id } }),
        c: await tx.credential.findUniqueOrThrow({ where: { id: f2.credentialRowId } }),
        leaves: await tx.proofPulseLeaf.count({ where: { treeId: tree.id } }),
        updates: await tx.proofPulseUpdate.count({ where: { treeId: tree.id } }),
        nodes: await tx.proofPulseNode.count({ where: { treeId: tree.id } }),
      };
    });
    expect(r.before).toMatchObject({ currentRootSeq: 2, nextLeafIndex: 2 });
    // The signature was accepted and kept; only the queuing failed, clearly and without losing it.
    expect(r.third.accepted).toMatchObject({ pipelineStatus: "SIGNED", queued: false, queueError: expect.stringMatching(/full/i) });
    expect(r.c.pipelineStatus).toBe("SIGNED");
    expect(r.after).toEqual(r.before);
    expect(r.leaves).toBe(2);
    expect(r.updates).toBe(2);
    expect(r.nodes).toBe(3); // 2 leaves + the root, untouched by the failed attempt
  });

  it("advancing time alone changes nothing: no root, node or history is touched", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      await signedContinuing(tx, ctx);
      await signedContinuing(tx, ctx);
      const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
      const snap = async () => ({
        tree: await tx.proofPulseTree.findUniqueOrThrow({ where: { id: tree.id } }),
        nodes: [...(await nodeSnapshot(tx, tree.id))].sort(),
        updates: await tx.proofPulseUpdate.count({ where: { treeId: tree.id } }),
        leaves: await tx.proofPulseLeaf.findMany({ where: { treeId: tree.id }, orderBy: { leafIndex: "asc" } }),
      });
      const before = await snap();
      // Two months later: sweeping, reading proofs and freshness evaluation never rebuild the tree.
      const later = new Date(SIGN_NOW.getTime() + 60 * 24 * 3600 * 1000);
      await enqueuePendingForOrganisation(tx, ctx.issuer, { now: later });
      const leaf = await tx.proofPulseLeaf.findFirstOrThrow({ where: { treeId: tree.id } });
      await getPulseProof(tx, ctx.issuer, leaf.credentialRowId);
      return { before, after: await snap() };
    });
    expect(r.after).toEqual(r.before);
  });
});
