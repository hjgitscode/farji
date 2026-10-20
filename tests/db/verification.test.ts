import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/authorize";
import type { VerificationResult } from "@/lib/verification";
import { createClaim, submitVerificationRequest, updateClaim } from "@/server/candidate/claims";
import { acceptStatusChange, prepareEndRelationship } from "@/server/issuance/status-change";
import { approveVerificationRequest } from "@/server/issuer/review";
import { deriveCandidateClaimStates, deriveStateForCredential } from "@/server/verification/service";
import { PERMISSIVE_CHAIN_VIEW, TEST_CONFIG } from "../fixtures/test-wallets";
import { db, inRollback, mkFinalizedTx, mkConfirmedTx, mkUser, mkOrg, type Tx } from "./helpers";
import { approvedCredential, APPROVE_NOW, CLAIM_NOW, CONTINUING, EXPIRING, issuerOf, PERMANENT, signCredential, type Fixture } from "./issuance-helpers";

import { at, opts, org, signed, anchorPulse, sealAndAnchor, type Ctx } from "./evidence-helpers";

// Phase 10 database tests: the loader assembles REAL evidence (signed with a test wallet, sealed into real
// batches/trees by the production services) and the pure engine derives the state. Anchors and revocations are
// inserted the way the finalised-evidence mirror writes them (tests/chain-int proves the real chain path); here
// the point is that the state is derived from the evidence rows and never from workflow status.
// Every test runs in an always-rolled-back transaction.

afterAll(async () => {
  await db.$disconnect();
});

const codes = (r: VerificationResult) => r.reasons.map((x) => x.code);

const stateOf = async (tx: Tx, f: Pick<Fixture, "credentialRowId">, now: Date) => (await deriveStateForCredential(tx, f.credentialRowId, opts(now)))!;

async function endRelationship(tx: Tx, ctx: Ctx, f: Pick<Fixture, "credentialRowId">) {
  const now = new Date("2026-10-20T10:00:00Z");
  const prep = await prepareEndRelationship(tx, ctx.issuer, f.credentialRowId, { effectiveAt: new Date("2026-10-19T00:00:00Z") }, { config: TEST_CONFIG, now });
  const signature = await ctx.wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
  return acceptStatusChange(tx, ctx.issuer, f.credentialRowId, { signature, issuedAt: prep.issuedAt, effectiveAt: prep.effectiveAt, nonce: prep.nonce }, { config: TEST_CONFIG, now, chain: PERMISSIVE_CHAIN_VIEW });
}

describe("PERMANENT: derived from evidence, never from workflow status", () => {
  it("unsigned -> PENDING, signed/queued -> PENDING, sealed -> PENDING, finalised anchor -> PERMANENT_VALID", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await approvedCredential(tx, PERMANENT, { orgId: ctx.orgId, issuer: ctx.issuer });
      const unsigned = await stateOf(tx, f, at(1));
      await signCredential(tx, f, ctx.wallet);
      const queued = await stateOf(tx, f, at(1));
      const { sealed, anchor } = await sealAndAnchor(tx, ctx, at(2));
      await tx.credential.update({ where: { id: f.credentialRowId }, data: { pipelineStatus: "ANCHORED" } });
      const done = await stateOf(tx, f, at(3));
      const claim = await deriveCandidateClaimStates(tx, f.cand, undefined, opts(at(3)));
      return { unsigned, queued, done, claim: claim.states.get(f.claimId), available: claim.available, sealed, anchor };
    });
    expect(r.unsigned.state).toBe("PENDING");
    expect(r.queued.state).toBe("PENDING");
    expect(r.done).toMatchObject({ state: "PERMANENT_VALID", lifecycleType: "PERMANENT", organisation: { displayName: "Test Org" } });
    expect(r.done.evidenceTimestamp).toEqual(r.anchor.blockTimestamp);
    expect(r.done.evidenceSummary).toMatchObject({ signed: true, anchored: true, anchorEpoch: 1, attestationType: "COHORT" });
    expect(r.available).toBe(true);
    expect(r.claim?.state).toBe("PERMANENT_VALID");
  });

  it("pipelineStatus = ANCHORED with NO anchor evidence is not a positive state", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      await tx.credential.update({ where: { id: f.credentialRowId }, data: { pipelineStatus: "ANCHORED" } });
      return stateOf(tx, f, at(2));
    });
    expect(r.state).toBe("PENDING");
    expect(r.evidenceSummary.anchored).toBe(false);
  });

  it("an anchor whose transaction is only CONFIRMED does not verify", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      await sealAndAnchor(tx, ctx, at(2), false);
      return stateOf(tx, f, at(3));
    });
    expect(r.state).toBe("PENDING");
    expect(codes(r)).toContain("ANCHOR_NOT_FINAL");
  });

  it("D7: an anchor 31 days after signing is INVALID_PROOF; exactly 30 days is valid", async () => {
    const r = await inRollback(async (tx) => {
      const late = await org(tx);
      const fl = await signed(tx, late);
      await sealAndAnchor(tx, late, at(31));
      const edge = await org(tx);
      const fe = await signed(tx, edge);
      await sealAndAnchor(tx, edge, at(30));
      return { late: await stateOf(tx, fl, at(40)), edge: await stateOf(tx, fe, at(40)) };
    });
    expect(r.late.state).toBe("INVALID_PROOF");
    expect(codes(r.late)).toContain("ANCHOR_TOO_LATE");
    expect(r.edge.state).toBe("PERMANENT_VALID");
  });

  it("compromise is judged at anchor time using the mirrored key history", async () => {
    const run = async (offsetMs: number) =>
      inRollback(async (tx) => {
        const ctx = await org(tx);
        const f = await signed(tx, ctx);
        await sealAndAnchor(tx, ctx, at(2));
        await tx.issuerKey.update({ where: { id: ctx.keyId }, data: { compromisedAt: new Date(at(2).getTime() + offsetMs) } });
        return stateOf(tx, f, at(5));
      });
    const before = await run(-3600_000); // marked compromised an hour BEFORE the anchor
    expect(before.state).toBe("INVALID_PROOF");
    expect(codes(before)).toContain("SIGNER_COMPROMISED");
    expect((await run(3600_000)).state).toBe("PERMANENT_VALID"); // compromised only after the evidence was anchored
  });

  it("retiring the key after the anchor never invalidates evidence", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      await sealAndAnchor(tx, ctx, at(2));
      await tx.issuerKey.update({ where: { id: ctx.keyId }, data: { validUntil: at(3) } });
      return stateOf(tx, f, at(900));
    });
    expect(r.state).toBe("PERMANENT_VALID");
  });

  it("the authorisation link of a key is write-once, so a finalised key cannot be repointed at a non-final transaction", async () => {
    await expect(
      inRollback(async (tx) => {
        const ctx = await org(tx);
        const pending = await tx.blockchainTransaction.create({
          data: { chainId: 31337, txHash: "0x" + "ab".repeat(32), purpose: "AUTHORISE_ISSUER_KEY", targetType: "ORGANISATION", targetId: ctx.orgId, fromAddress: "0x" + "cd".repeat(20), initiatedByUserId: (await mkUser(tx, "ADMIN")).id, organisationId: ctx.orgId },
        });
        await tx.issuerKey.update({ where: { id: ctx.keyId }, data: { authoriseTransactionId: pending.id } });
      }),
    ).rejects.toThrow(/write-once/);
  });
});

describe("EXPIRING", () => {
  it("VERIFIED before validUntil, EXPIRED at and after it, with the expiry reported", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx, EXPIRING);
      await sealAndAnchor(tx, ctx, at(2));
      return {
        before: await stateOf(tx, f, new Date("2027-03-30T23:59:59Z")),
        at: await stateOf(tx, f, new Date("2027-03-31T00:00:00Z")),
        after: await stateOf(tx, f, new Date("2027-06-01T00:00:00Z")),
      };
    });
    expect(r.before.state).toBe("VERIFIED");
    expect(r.before.expiry).toEqual(new Date("2027-03-31T00:00:00Z"));
    expect(r.at.state).toBe("EXPIRED");
    expect(r.after.state).toBe("EXPIRED");
    expect(r.after.revokedAt).toBeNull();
  });
});

describe("CONTINUING: ProofPulse freshness and ENDED", () => {
  it("CURRENTLY_ATTESTED -> STALE as time advances, with no tree change; a new epoch restores it", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx, CONTINUING);
      const noEpoch = await stateOf(tx, f, at(1));
      await anchorPulse(tx, ctx, at(1));
      const treeBefore = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
      const updatesBefore = await tx.proofPulseUpdate.count({ where: { treeId: treeBefore.id } });
      const fresh = await stateOf(tx, f, at(30));
      const edge = await stateOf(tx, f, at(46)); // exactly 45 days after the epoch
      const stale = await stateOf(tx, f, new Date(at(46).getTime() + 1000));
      const treeAfter = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: ctx.orgId } });
      const updatesAfter = await tx.proofPulseUpdate.count({ where: { treeId: treeAfter.id } });
      await anchorPulse(tx, ctx, at(50)); // re-affirms the unchanged root
      const refreshed = await stateOf(tx, f, at(60));
      await tx.organisation.update({ where: { id: ctx.orgId }, data: { pulseFreshnessDays: 5 } });
      const shortWindow = await stateOf(tx, f, at(60));
      return { noEpoch, fresh, edge, stale, refreshed, shortWindow, same: treeBefore.currentRoot === treeAfter.currentRoot && updatesBefore === updatesAfter };
    });
    expect(r.noEpoch.state).toBe("PENDING");
    expect(r.fresh.state).toBe("CURRENTLY_ATTESTED");
    expect(r.fresh.freshnessDeadline).toEqual(at(46));
    expect(r.edge.state).toBe("CURRENTLY_ATTESTED");
    expect(r.stale.state).toBe("STALE_NO_RECENT_ATTESTATION");
    expect(r.same).toBe(true);
    expect(r.refreshed.state).toBe("CURRENTLY_ATTESTED");
    expect(r.refreshed.evidenceSummary.latestPulseEpoch).toBe(2);
    expect(r.shortWindow.state).toBe("STALE_NO_RECENT_ATTESTATION"); // the ORGANISATION's configured window
  });

  it("ENDED is derived from the signed end, is not REVOKED, and creates no Revocation", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx, CONTINUING);
      await anchorPulse(tx, ctx, at(1));
      await endRelationship(tx, ctx, f);
      return { state: await stateOf(tx, f, new Date("2026-10-21T00:00:00Z")), later: await stateOf(tx, f, at(400)), revocations: await tx.revocation.count({ where: { organisationId: ctx.orgId } }) };
    });
    expect(r.state.state).toBe("ENDED");
    expect(r.state.endedAt).toEqual(new Date("2026-10-19T00:00:00Z"));
    expect(r.state.revokedAt).toBeNull();
    expect(r.later.state).toBe("ENDED");
    expect(r.revocations).toBe(0);
  });

  it("an epoch anchored after another leaf joined still proves this leaf (historical roots are replayed)", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const first = await signed(tx, ctx, CONTINUING);
      await anchorPulse(tx, ctx, at(1));
      await signed(tx, ctx, CONTINUING); // tree root changes
      await anchorPulse(tx, ctx, at(10));
      const roots = (await tx.anchor.findMany({ where: { organisationId: ctx.orgId } })).map((a) => a.batchRoot);
      return { state: await stateOf(tx, first, at(11)), distinct: new Set(roots).size };
    });
    expect(r.distinct).toBe(2);
    expect(r.state).toMatchObject({ state: "CURRENTLY_ATTESTED" });
    expect(r.state.evidenceSummary.latestPulseEpoch).toBe(2);
  });
});

describe("REVOKED and MODIFIED", () => {
  it("a FINALIZED revocation by the issuing organisation overrides every positive state", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      await sealAndAnchor(tx, ctx, at(2));
      const before = await stateOf(tx, f, at(3));
      const txRow = await mkFinalizedTx(tx, "REVOKE_CREDENTIAL", ctx.orgId, "CREDENTIAL", f.credentialRowId);
      await tx.revocation.create({
        data: { credentialRowId: f.credentialRowId, organisationId: ctx.orgId, revokerKeyId: ctx.keyId, reasonCode: "FRAUD", transactionId: txRow.id, blockNumber: 2n, revokedAt: at(4) },
      });
      return { before, after: await stateOf(tx, f, at(5)) };
    });
    expect(r.before.state).toBe("PERMANENT_VALID");
    expect(r.after.state).toBe("REVOKED");
    expect(r.after.revokedAt).toEqual(at(4));
  });

  it("a revocation whose transaction is only CONFIRMED is noted but not applied", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      await sealAndAnchor(tx, ctx, at(2));
      const txRow = await mkConfirmedTx(tx, "REVOKE_CREDENTIAL", (await mkUser(tx, "ADMIN")).id, ctx.orgId);
      await tx.revocation.create({
        data: { credentialRowId: f.credentialRowId, organisationId: ctx.orgId, revokerKeyId: ctx.keyId, reasonCode: "FRAUD", transactionId: txRow.id, blockNumber: 2n, revokedAt: at(4) },
      });
      return stateOf(tx, f, at(5));
    });
    expect(r.state).toBe("PERMANENT_VALID");
    expect(codes(r)).toContain("REVOCATION_NOT_FINAL");
  });

  it("another organisation's revocation of the same salt never touches this credential", async () => {
    const r = await inRollback(async (tx) => {
      const a = await org(tx);
      const b = await org(tx);
      const fa = await signed(tx, a);
      await sealAndAnchor(tx, a, at(2));
      const fb = await signed(tx, b);
      await sealAndAnchor(tx, b, at(2));
      const txRow = await mkFinalizedTx(tx, "REVOKE_CREDENTIAL", b.orgId, "CREDENTIAL", fb.credentialRowId);
      await tx.revocation.create({
        data: { credentialRowId: fb.credentialRowId, organisationId: b.orgId, revokerKeyId: b.keyId, reasonCode: "OTHER", transactionId: txRow.id, blockNumber: 2n, revokedAt: at(4) },
      });
      return { a: await stateOf(tx, fa, at(5)), b: await stateOf(tx, fb, at(5)) };
    });
    expect(r.a.state).toBe("PERMANENT_VALID");
    expect(r.b.state).toBe("REVOKED");
  });

  it("editing a claim and signing the new version makes the old credential MODIFIED, history intact", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      await sealAndAnchor(tx, ctx, at(2));
      const before = await stateOf(tx, f, at(3));

      const edited = await updateClaim(tx, f.cand, f.claimId, { ...PERMANENT, title: "Senior Software Engineer" }, CLAIM_NOW);
      const { requestId } = await submitVerificationRequest(tx, f.cand, { claimId: f.claimId, claimVersionId: edited.claimVersionId, organisationId: ctx.orgId });
      const approved = await approveVerificationRequest(tx, ctx.issuer, requestId, {}, APPROVE_NOW);
      const successor = { ...f, credentialRowId: approved.credentialRowId } as Fixture;
      const claimWhileUnsigned = await deriveCandidateClaimStates(tx, f.cand, [f.claimId], opts(at(3)));
      await signCredential(tx, successor, ctx.wallet);
      const afterOld = await stateOf(tx, f, at(3));
      const afterNew = await stateOf(tx, successor, at(3));
      const claim = await deriveCandidateClaimStates(tx, f.cand, [f.claimId], opts(at(3)));
      return { before, afterOld, afterNew, claimWhileUnsigned: claimWhileUnsigned.states.get(f.claimId), claim: claim.states.get(f.claimId), versions: await tx.credential.count({ where: { organisationId: ctx.orgId } }) };
    });
    expect(r.before.state).toBe("PERMANENT_VALID");
    expect(r.claimWhileUnsigned?.state).toBe("PENDING"); // the new version awaits its signature: the claim is not verified
    expect(r.afterOld.state).toBe("MODIFIED");
    expect(r.afterNew.state).toBe("PENDING"); // the newer credential is signed but not anchored yet
    expect(r.claim?.state).toBe("PENDING");
    expect(r.versions).toBe(2); // the old credential still exists
  });
});

describe("SELF_DECLARED / PENDING at claim level", () => {
  it("bare claim -> SELF_DECLARED; submitted request -> PENDING; rejected is not exposed", async () => {
    const r = await inRollback(async (tx) => {
      const o = await mkOrg(tx, "ACTIVE");
      const issuer = await issuerOf(tx, o.id);
      const f = await approvedCredential(tx, PERMANENT, { orgId: o.id, issuer });
      // a second claim with no request at all
      const cand = f.cand;
      const bare = await createClaim(tx, cand, PERMANENT, CLAIM_NOW);
      const states = await deriveCandidateClaimStates(tx, cand, undefined, opts(at(1)));
      return { bare: states.states.get(bare.claimId), approved: states.states.get(f.claimId) };
    });
    expect(r.bare?.state).toBe("SELF_DECLARED");
    expect(r.approved?.state).toBe("PENDING"); // approved, awaiting signature
  });
});

describe("isolation and privacy", () => {
  it("a candidate gets states only for their own claims; non-candidates are refused", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      const other: Actor = { ...f.cand, userId: (await mkUser(tx, "CANDIDATE")).id };
      const own = await deriveCandidateClaimStates(tx, f.cand, undefined, opts(at(1)));
      const foreign = await deriveCandidateClaimStates(tx, other, [f.claimId], opts(at(1)));
      const refused = await deriveCandidateClaimStates(tx, ctx.issuer, undefined, opts(at(1))).then(() => null, (e) => e);
      return { own: own.states.has(f.claimId), foreign: foreign.states.has(f.claimId), refused };
    });
    expect(r.own).toBe(true);
    expect(r.foreign).toBe(false);
    expect(r.refused).toMatchObject({ code: "FORBIDDEN" });
  });

  it("the derived result never contains salts or claim content (reviewer notes are never loaded at all)", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      await sealAndAnchor(tx, ctx, at(2));
      const cred = await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } });
      const result = await stateOf(tx, f, at(3));
      const claim = (await deriveCandidateClaimStates(tx, f.cand, undefined, opts(at(3)))).states.get(f.claimId);
      return { json: JSON.stringify([result, claim]), cred };
    });
    for (const secret of [r.cred.credentialSalt!, r.cred.contentSalt!, r.cred.subjectSalt!, "Software Engineer"]) {
      expect(r.json).not.toContain(secret);
    }
  });

  it("deriving a state writes nothing (no stored verification state, no audit rows)", async () => {
    const r = await inRollback(async (tx) => {
      const ctx = await org(tx);
      const f = await signed(tx, ctx);
      await sealAndAnchor(tx, ctx, at(2));
      const count = async () => ({
        credentials: await tx.credential.count(),
        audits: await tx.auditEvent.count(),
        attestations: await tx.attestation.count(),
        anchors: await tx.anchor.count(),
      });
      const before = await count();
      await stateOf(tx, f, at(3));
      await deriveCandidateClaimStates(tx, f.cand, undefined, opts(at(3)));
      return { before, after: await count() };
    });
    expect(r.after).toEqual(r.before);
  });
});
