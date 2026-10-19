import { afterAll, describe, expect, it } from "vitest";
import { SCHEMA_ID } from "@/lib/crypto/constants";
import { dateToUnixSeconds } from "@/lib/crypto/encoding";
import { buildCohortTree, cohortLeafHash, verifyCohortProof } from "@/lib/merkle/cohort";
import { enqueuePendingForOrganisation, enqueueSignedCredential } from "@/server/merkle/enqueue";
import { getCohortProof, sealCohortBatch } from "@/server/merkle/cohort";
import { freshWallet } from "../fixtures/test-wallets";
import { db, inRollback, mkOrg, type Tx } from "./helpers";
import { addKey, approvedCredential, CONTINUING, EXPIRING, issuerOf, PERMANENT, signCredential, SIGN_NOW, type Fixture } from "./issuance-helpers";

afterAll(async () => {
  await db.$disconnect();
});

const caught = (p: Promise<unknown>) => p.then(() => null, (e) => e);

/** An organisation with an issuer and one open issuer key; `n` signed (and queued) credentials. */
async function org(tx: Tx) {
  const o = await mkOrg(tx, "ACTIVE");
  const issuer = await issuerOf(tx, o.id);
  const wallet = freshWallet();
  await addKey(tx, o.id, wallet);
  return { orgId: o.id, issuer, wallet };
}

async function signed(tx: Tx, ctx: Awaited<ReturnType<typeof org>>, draft: Record<string, unknown> = PERMANENT, enqueue = true): Promise<Fixture> {
  const f = await approvedCredential(tx, draft, { orgId: ctx.orgId, issuer: ctx.issuer });
  await signCredential(tx, f, ctx.wallet, { enqueue });
  return f;
}

const leafInputOf = async (tx: Tx, credentialRowId: string) => {
  const c = await tx.credential.findUniqueOrThrow({ where: { id: credentialRowId }, include: { organisation: true } });
  return {
    orgId: c.organisation.orgId,
    credentialId: c.credentialId!,
    subjectCommitment: c.subjectCommitment!,
    contentDigest: c.contentDigest!,
    lifecycleType: c.lifecycleType === "PERMANENT" ? 0 : 2,
    validFrom: dateToUnixSeconds(c.validFrom!),
    validUntil: c.validUntil ? dateToUnixSeconds(c.validUntil) : 0n,
    issuedAt: dateToUnixSeconds(c.issuedAt!),
    schemaId: SCHEMA_ID,
  };
};

describe("queuing signed credentials into the OPEN batch", () => {
  it("a signed PERMANENT credential joins the organisation's OPEN batch and becomes QUEUED_FOR_ANCHOR", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      return {
        f,
        c: await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } }),
        leaves: await tx.cohortLeaf.findMany({ where: { organisationId: ctx.orgId }, include: { batch: true } }),
        input: await leafInputOf(tx, f.credentialRowId),
        pulseLeaves: await tx.proofPulseLeaf.count({ where: { organisationId: ctx.orgId } }),
        audits: await tx.auditEvent.findMany({ where: { targetId: f.credentialRowId, action: "COHORT_LEAF_ADDED" } }),
      };
    });
    expect(r.c.pipelineStatus).toBe("QUEUED_FOR_ANCHOR");
    expect(r.leaves).toHaveLength(1);
    expect(r.leaves[0]).toMatchObject({ credentialRowId: r.f.credentialRowId, position: 0, proof: null });
    expect(r.leaves[0].leafHash).toBe(cohortLeafHash(r.input));
    expect(r.leaves[0].batch).toMatchObject({ status: "OPEN", batchRoot: null, leafCount: null });
    expect(r.pulseLeaves).toBe(0);
    expect(r.audits).toHaveLength(1);
  });

  it("an EXPIRING credential goes to the cohort and keeps its expiry in the leaf", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx, EXPIRING);
      return { leaf: await tx.cohortLeaf.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } }), input: await leafInputOf(tx, f.credentialRowId) };
    });
    expect(r.input.lifecycleType).toBe(2);
    expect(r.input.validUntil).toBeGreaterThan(0n);
    expect(r.leaf.leafHash).toBe(cohortLeafHash(r.input));
  });

  it("a CONTINUING credential never enters CohortProof (it goes to ProofPulse); the database also forbids it", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx, CONTINUING);
      return { cohort: await tx.cohortLeaf.count({ where: { organisationId: ctx.orgId } }), pulse: await tx.proofPulseLeaf.count({ where: { organisationId: ctx.orgId } }), f, ctx };
    });
    expect(r.cohort).toBe(0);
    expect(r.pulse).toBe(1);

    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        const f = await signed(tx, ctx, CONTINUING);
        const batch = await tx.cohortBatch.create({ data: { organisationId: ctx.orgId, label: "x" } });
        await tx.cohortLeaf.create({ data: { batchId: batch.id, credentialRowId: f.credentialRowId, organisationId: ctx.orgId, position: 0, leafHash: "0x" + "ab".repeat(32) } });
      }),
    ).rejects.toThrow(/CONTINUING/);
  });

  it("queuing is idempotent: enqueueing again adds no second leaf", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      const scope = { userId: ctx.issuer.userId, organisationId: ctx.orgId, memberId: ctx.issuer.memberId! };
      const again = await enqueueSignedCredential(tx, scope, f.credentialRowId, { now: SIGN_NOW });
      return { again, leaves: await tx.cohortLeaf.count({ where: { organisationId: ctx.orgId } }) };
    });
    expect(r.again).toMatchObject({ engine: "COHORT", alreadyQueued: true, pipelineStatus: "QUEUED_FOR_ANCHOR" });
    expect(r.leaves).toBe(1);
  });

  it("an unsigned credential cannot be queued", async () => {
    const err = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await approvedCredential(tx, PERMANENT, { orgId: ctx.orgId, issuer: ctx.issuer });
      const scope = { userId: ctx.issuer.userId, organisationId: ctx.orgId, memberId: ctx.issuer.memberId! };
      return caught(enqueueSignedCredential(tx, scope, f.credentialRowId, { now: SIGN_NOW }));
    });
    expect(err).toMatchObject({ code: "CONFLICT" });
  });

  it("the retry sweep queues credentials that were SIGNED but not yet queued", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f1 = await signed(tx, ctx, PERMANENT, false);
      const f2 = await signed(tx, ctx, CONTINUING, false);
      const before = await tx.credential.findMany({ where: { id: { in: [f1.credentialRowId, f2.credentialRowId] } }, select: { pipelineStatus: true } });
      const results = await enqueuePendingForOrganisation(tx, ctx.issuer, { now: SIGN_NOW });
      const after = await tx.credential.findMany({ where: { id: { in: [f1.credentialRowId, f2.credentialRowId] } }, select: { pipelineStatus: true } });
      return { before, after, results };
    });
    expect(r.before.every((c) => c.pipelineStatus === "SIGNED")).toBe(true);
    expect(r.results).toHaveLength(2);
    expect(r.results.every((x) => x.queued)).toBe(true);
    expect(r.after.every((c) => c.pipelineStatus === "QUEUED_FOR_ANCHOR")).toBe(true);
  });

  it("another organisation's issuer cannot queue or read this organisation's credential", async () => {
    const r = await inRollback(async (tx) => {
      const a = await org(tx);
      const f = await signed(tx, a, PERMANENT, false);
      const b = await org(tx);
      const scopeB = { userId: b.issuer.userId, organisationId: b.orgId, memberId: b.issuer.memberId! };
      return {
        enqueue: await caught(enqueueSignedCredential(tx, scopeB, f.credentialRowId, { now: SIGN_NOW })),
        proof: await caught(getCohortProof(tx, b.issuer, f.credentialRowId)),
      };
    });
    expect(r.enqueue).toMatchObject({ code: "NOT_FOUND" });
    expect(r.proof).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("sealing a batch", () => {
  it("builds the deterministic root, stores each proof once and marks the batch SEALED", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const fs = [await signed(tx, ctx), await signed(tx, ctx), await signed(tx, ctx, EXPIRING)];
      const inputs = await Promise.all(fs.map((f) => leafInputOf(tx, f.credentialRowId)));
      const sealed = await sealCohortBatch(tx, ctx.issuer, { now: SIGN_NOW });
      return {
        ctx,
        fs,
        inputs,
        sealed,
        stored: await tx.cohortBatch.findMany({ where: { organisationId: ctx.orgId } }),
        leaves: await tx.cohortLeaf.findMany({ where: { organisationId: ctx.orgId }, orderBy: { position: "asc" } }),
        audits: await tx.auditEvent.findMany({ where: { action: "COHORT_BATCH_SEALED", organisationId: ctx.orgId } }),
      };
    });
    const expected = buildCohortTree(r.inputs);
    expect(r.sealed.batchRoot).toBe(expected.root);
    expect(r.sealed.leafCount).toBe(3);
    expect(r.stored).toHaveLength(1);
    expect(r.stored[0]).toMatchObject({ status: "SEALED", batchRoot: expected.root, leafCount: 3 });
    expect(r.stored[0].sealedAt?.toISOString()).toBe(SIGN_NOW.toISOString());
    for (const leaf of r.leaves) {
      expect(leaf.proof).not.toBeNull();
      expect(verifyCohortProof(expected.root, leaf.leafHash, leaf.proof as { siblings: string[] })).toBe(true);
    }
    expect(r.audits).toHaveLength(1);
  });

  it("the root is independent of insertion order", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const fs = [await signed(tx, ctx), await signed(tx, ctx), await signed(tx, ctx)];
      return { inputs: await Promise.all(fs.map((f) => leafInputOf(tx, f.credentialRowId))), sealed: await sealCohortBatch(tx, ctx.issuer) };
    });
    // The sealed root equals the tree built from the same leaves in any other order.
    expect(r.sealed.batchRoot).toBe(buildCohortTree([...r.inputs].reverse()).root);
    expect(r.sealed.batchRoot).toBe(buildCohortTree([r.inputs[1], r.inputs[2], r.inputs[0]]).root);
  });

  it("getCohortProof returns the stored proof, which verifies against the batch root", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      await signed(tx, ctx);
      const before = await getCohortProof(tx, ctx.issuer, f.credentialRowId);
      await sealCohortBatch(tx, ctx.issuer);
      return { before, after: await getCohortProof(tx, ctx.issuer, f.credentialRowId) };
    });
    expect(r.before).toMatchObject({ batchStatus: "OPEN", batchRoot: null, proof: null });
    expect(r.after.batchStatus).toBe("SEALED");
    expect(verifyCohortProof(r.after.batchRoot!, r.after.leafHash, r.after.proof!)).toBe(true);
  });

  it("a single-leaf batch seals (root = the leaf, empty proof)", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      const sealed = await sealCohortBatch(tx, ctx.issuer);
      return { sealed, proof: await getCohortProof(tx, ctx.issuer, f.credentialRowId) };
    });
    expect(r.sealed.leafCount).toBe(1);
    expect(r.proof.proof?.siblings).toEqual([]);
    expect(r.sealed.batchRoot).toBe(r.proof.leafHash);
  });

  it("rejects sealing when there is nothing to seal: no open batch, or an empty one", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const none = await caught(sealCohortBatch(tx, ctx.issuer));
      await tx.cohortBatch.create({ data: { organisationId: ctx.orgId, label: "empty" } });
      const empty = await caught(sealCohortBatch(tx, ctx.issuer));
      return { none, empty, batch: await tx.cohortBatch.findFirstOrThrow({ where: { organisationId: ctx.orgId } }) };
    });
    expect(r.none).toMatchObject({ code: "CONFLICT" });
    expect(r.empty).toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/empty/i) });
    expect(r.batch.status).toBe("OPEN");
  });

  it("another organisation's issuer cannot seal this organisation's batch (they see only their own)", async () => {
    const r = await inRollback(async (tx) => {
      const a = await org(tx);
      await signed(tx, a);
      const b = await org(tx);
      const err = await caught(sealCohortBatch(tx, b.issuer));
      return { err, batch: await tx.cohortBatch.findFirstOrThrow({ where: { organisationId: a.orgId } }) };
    });
    expect(r.err).toMatchObject({ code: "CONFLICT" });
    expect(r.batch.status).toBe("OPEN");
  });

  it("non-issuers cannot seal", async () => {
    const err = await inRollback(async (tx) => {
      const ctx = await org(tx);
      await signed(tx, ctx);
      return caught(sealCohortBatch(tx, { ...ctx.issuer, role: "CANDIDATE" }));
    });
    expect(err).toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("supplementary batches and immutability of sealed batches", () => {
  it("a late entrant goes into a NEW batch; the sealed batch (root, leaves, proofs) never changes", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const early = [await signed(tx, ctx), await signed(tx, ctx)];
      const sealed = await sealCohortBatch(tx, ctx.issuer);
      const snapshot = async () => ({
        leaves: await tx.cohortLeaf.findMany({ where: { batchId: sealed.batchId }, orderBy: { position: "asc" } }),
        sealedBatch: await tx.cohortBatch.findMany({ where: { id: sealed.batchId } }),
      });
      const before = await snapshot();
      const late = await signed(tx, ctx);
      const after = await snapshot();
      return {
        sealed,
        early,
        before,
        after,
        late,
        lateLeaf: await tx.cohortLeaf.findFirstOrThrow({ where: { credentialRowId: late.credentialRowId }, include: { batch: true } }),
        batches: await tx.cohortBatch.findMany({ where: { organisationId: ctx.orgId }, orderBy: { createdAt: "asc" } }),
      };
    });
    expect(r.lateLeaf.batchId).not.toBe(r.sealed.batchId);
    expect(r.lateLeaf.batch.status).toBe("OPEN");
    expect(r.batches.map((b) => b.status)).toEqual(["SEALED", "OPEN"]);
    expect(r.after.leaves).toEqual(r.before.leaves); // same leaves, same proofs
    expect(r.after.sealedBatch).toEqual(r.before.sealedBatch); // same root, same leafCount, same sealedAt
    expect(r.after.sealedBatch[0].leafCount).toBe(2);
    expect(r.after.leaves).toHaveLength(2);
  });

  it("the database refuses to change a sealed batch's root", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        await signed(tx, ctx);
        const sealed = await sealCohortBatch(tx, ctx.issuer);
        await tx.cohortBatch.update({ where: { id: sealed.batchId }, data: { batchRoot: "0x" + "ab".repeat(32) } });
      }),
    ).rejects.toThrow(/write-once/);
  });

  it("the database refuses to add a leaf to a sealed batch", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        await signed(tx, ctx);
        const sealed = await sealCohortBatch(tx, ctx.issuer);
        // A second signed credential, then force it into the SEALED batch directly.
        const f2 = await signed(tx, ctx, PERMANENT, false);
        await tx.cohortLeaf.create({ data: { batchId: sealed.batchId, credentialRowId: f2.credentialRowId, organisationId: ctx.orgId, position: 1, leafHash: "0x" + "ab".repeat(32) } });
      }),
    ).rejects.toThrow(/OPEN/);
  });

  it("the database refuses to rewrite a stored proof", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        const f = await signed(tx, ctx);
        await sealCohortBatch(tx, ctx.issuer);
        const leaf = await tx.cohortLeaf.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } });
        // (A single-leaf batch's proof is already {siblings: []}; write a DIFFERENT value.)
        await tx.cohortLeaf.update({ where: { id: leaf.id }, data: { proof: { v: 1, treeIndex: 0, siblings: ["0x" + "ab".repeat(32)] } } });
      }),
    ).rejects.toThrow(/write-once/);
  });

  it("the database refuses to delete a leaf of a sealed batch", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        const f = await signed(tx, ctx);
        await sealCohortBatch(tx, ctx.issuer);
        const leaf = await tx.cohortLeaf.findFirstOrThrow({ where: { credentialRowId: f.credentialRowId } });
        await tx.cohortLeaf.delete({ where: { id: leaf.id } });
      }),
    ).rejects.toThrow(/sealed/);
  });

  it("a sealed batch cannot go back to OPEN", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        await signed(tx, ctx);
        const sealed = await sealCohortBatch(tx, ctx.issuer);
        await tx.cohortBatch.update({ where: { id: sealed.batchId }, data: { status: "OPEN" } });
      }),
    ).rejects.toThrow(/backwards/);
  });

  it("only one OPEN batch exists per organisation", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        await tx.cohortBatch.create({ data: { organisationId: ctx.orgId, label: "a" } });
        await tx.cohortBatch.create({ data: { organisationId: ctx.orgId, label: "b" } });
      }),
    ).rejects.toThrow();
  });
});
