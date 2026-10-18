import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/authorize";
import { createClaim, getCandidateClaim, listCandidateClaims, submitVerificationRequest, updateClaim, withdrawVerificationRequest } from "@/server/candidate/claims";
import { approveVerificationRequest, getIssuerRequest, listIssuerRequests, rejectVerificationRequest } from "@/server/issuer/review";
import { db, inRollback, mkMember, mkOrg, mkUser, type Tx } from "./helpers";

afterAll(async () => {
  await db.$disconnect();
});

const NOW = new Date("2026-10-15T12:00:00Z");
const LATER = new Date("2026-10-16T09:00:00Z");

const PERMANENT = {
  category: "EXPERIENCE",
  lifecycleType: "PERMANENT",
  title: "Software Engineer",
  organisationName: "Acme Ltd",
  startDate: "2022-01-10",
  endDate: "2024-03-31",
};
const CONTINUING = { ...PERMANENT, lifecycleType: "CONTINUING", endDate: "" };
const EXPIRING = { ...PERMANENT, category: "CERTIFICATION", lifecycleType: "EXPIRING", endDate: "", expiryDate: "2027-03-31" };

const candidateActor = (userId: string): Actor => ({
  userId,
  authUserId: randomUUID(),
  role: "CANDIDATE",
  organisationId: null,
  organisationStatus: null,
  memberId: null,
});

async function candidate(tx: Tx) {
  return candidateActor((await mkUser(tx, "CANDIDATE")).id);
}

async function issuerOf(tx: Tx, organisationId: string, organisationStatus: Actor["organisationStatus"] = "ACTIVE"): Promise<Actor> {
  const { user, member } = await mkMember(tx, organisationId);
  return { userId: user.id, authUserId: randomUUID(), role: "ISSUER", organisationId, organisationStatus, memberId: member.id };
}

/** A candidate with a claim whose latest version has an OPEN request to the organisation. */
async function openRequest(tx: Tx, organisationId: string, draft: Record<string, unknown> = PERMANENT) {
  const cand = await candidate(tx);
  const { claimId, claimVersionId } = await createClaim(tx, cand, draft, NOW);
  const { requestId } = await submitVerificationRequest(tx, cand, { claimId, claimVersionId, organisationId });
  return { cand, claimId, claimVersionId, requestId };
}

async function setup(tx: Tx, draft: Record<string, unknown> = PERMANENT) {
  const org = await mkOrg(tx, "ACTIVE");
  const issuer = await issuerOf(tx, org.id);
  return { org, issuer, ...(await openRequest(tx, org.id, draft)) };
}

describe("issuer queue and cross-organisation isolation (4, 5)", () => {
  it("4. an issuer sees only requests addressed to their own organisation", async () => {
    const r = await inRollback(async (tx) => {
      const a = await setup(tx);
      const bOrg = await mkOrg(tx, "ACTIVE");
      const bIssuer = await issuerOf(tx, bOrg.id);
      const b = await openRequest(tx, bOrg.id);
      return {
        a,
        b,
        listA: await listIssuerRequests(tx, a.issuer, "all"),
        listB: await listIssuerRequests(tx, bIssuer, "all"),
      };
    });
    expect(r.listA.map((x) => x.id)).toEqual([r.a.requestId]);
    expect(r.listB.map((x) => x.id)).toEqual([r.b.requestId]);
  });

  it("the open filter excludes decided requests; 'all' keeps them", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      await rejectVerificationRequest(tx, s.issuer, s.requestId, { rejectionReason: "RECORD_NOT_FOUND" }, LATER);
      return { open: await listIssuerRequests(tx, s.issuer), all: await listIssuerRequests(tx, s.issuer, "all") };
    });
    expect(r.open).toHaveLength(0);
    expect(r.all).toHaveLength(1);
  });

  it("5. another organisation's request is NOT_FOUND to read, approve and reject, and stays untouched", async () => {
    const r = await inRollback(async (tx) => {
      const a = await setup(tx);
      const bOrg = await mkOrg(tx, "ACTIVE");
      const bIssuer = await issuerOf(tx, bOrg.id);
      const get = await getIssuerRequest(tx, bIssuer, a.requestId).catch((e) => e);
      const approve = await approveVerificationRequest(tx, bIssuer, a.requestId, {}, LATER).catch((e) => e);
      const reject = await rejectVerificationRequest(tx, bIssuer, a.requestId, { rejectionReason: "OTHER", notes: "x" }, LATER).catch((e) => e);
      return {
        get,
        approve,
        reject,
        request: await tx.verificationRequest.findUniqueOrThrow({ where: { id: a.requestId } }),
        decisions: await tx.reviewDecision.count({ where: { verificationRequestId: a.requestId } }),
        credentials: await tx.credential.count({ where: { claimVersionId: a.claimVersionId } }),
      };
    });
    for (const e of [r.get, r.approve, r.reject]) expect(e).toMatchObject({ code: "NOT_FOUND" });
    expect(r.request.status).toBe("SUBMITTED");
    expect(r.decisions).toBe(0);
    expect(r.credentials).toBe(0);
  });

  it("getIssuerRequest returns the exact version content and flags it as the current version", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      return { s, view: await getIssuerRequest(tx, s.issuer, s.requestId) };
    });
    expect(r.view.claimVersion).toMatchObject({
      id: r.s.claimVersionId,
      versionNumber: 1,
      proposedLifecycleType: "PERMANENT",
      category: "EXPERIENCE",
      isCurrentVersion: true,
    });
    expect(r.view.isOwnClaim).toBe(false);
  });
});

describe("membership is re-checked inside the transaction (2, 3)", () => {
  it("2. a member who was removed after the guard ran cannot decide", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      await tx.organisationMember.update({ where: { id: s.issuer.memberId! }, data: { status: "REMOVED", removedAt: new Date() } });
      const approve = await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER).catch((e) => e);
      const reject = await rejectVerificationRequest(tx, s.issuer, s.requestId, { rejectionReason: "OTHER", notes: "x" }, LATER).catch((e) => e);
      return { approve, reject, status: (await tx.verificationRequest.findUniqueOrThrow({ where: { id: s.requestId } })).status };
    });
    expect(r.approve).toMatchObject({ code: "FORBIDDEN" });
    expect(r.reject).toMatchObject({ code: "FORBIDDEN" });
    expect(r.status).toBe("SUBMITTED");
  });

  it("3. an organisation suspended after the guard ran cannot decide", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      await tx.organisation.update({ where: { id: s.org.id }, data: { status: "SUSPENDED" } });
      const approve = await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER).catch((e) => e);
      return { approve, credentials: await tx.credential.count({ where: { claimVersionId: s.claimVersionId } }) };
    });
    expect(r.approve).toMatchObject({ code: "FORBIDDEN" });
    expect(r.credentials).toBe(0);
  });

  it("a member of ANOTHER organisation cannot be used as the reviewer (member/organisation mismatch)", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const other = await mkOrg(tx, "ACTIVE");
      const otherIssuer = await issuerOf(tx, other.id);
      // Forged actor: A's organisation with B's member id.
      const forged: Actor = { ...s.issuer, memberId: otherIssuer.memberId };
      return approveVerificationRequest(tx, forged, s.requestId, {}, LATER).catch((e) => e);
    });
    expect(r).toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("approve (6-13)", () => {
  it("8-11. approving creates one decision, an APPROVED request and exactly one AWAITING_SIGNATURE credential", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const result = await approveVerificationRequest(tx, s.issuer, s.requestId, { notes: "checked", sourceOfTruthReference: "HR-1" }, LATER);
      return {
        s,
        result,
        request: await tx.verificationRequest.findUniqueOrThrow({ where: { id: s.requestId } }),
        decisions: await tx.reviewDecision.findMany({ where: { verificationRequestId: s.requestId } }),
        credentials: await tx.credential.findMany({ where: { claimVersionId: s.claimVersionId } }),
        audits: await tx.auditEvent.findMany({ where: { targetId: s.requestId, action: "REQUEST_APPROVED" } }),
      };
    });
    expect(r.request).toMatchObject({ status: "APPROVED", closedAt: LATER });
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({
      decision: "APPROVE",
      rejectionReason: null,
      organisationId: r.s.org.id,
      reviewerMemberId: r.s.issuer.memberId,
      notes: "checked",
      sourceOfTruthReference: "HR-1",
    });
    expect(r.credentials).toHaveLength(1);
    const c = r.credentials[0];
    expect(c.claimVersionId).toBe(r.s.claimVersionId); // 9: exact ClaimVersion
    expect(c.organisationId).toBe(r.s.org.id); // 10: reviewing organisation
    expect(c.lifecycleType).toBe("PERMANENT"); // 11
    expect(c.reviewDecisionId).toBe(r.decisions[0].id);
    expect(c.pipelineStatus).toBe("AWAITING_SIGNATURE");
    // Nothing cryptographic exists yet: Phase 6 creates the ids, salts and digests at signing.
    expect(c).toMatchObject({
      credentialId: null,
      credentialSalt: null,
      contentSalt: null,
      subjectSalt: null,
      subjectCommitment: null,
      contentDigest: null,
      validUntil: null,
      issuedAt: null,
    });
    expect(r.audits).toHaveLength(1);
    expect(r.audits[0]).toMatchObject({ actorUserId: r.s.issuer.userId, actorRole: "ISSUER", organisationId: r.s.org.id });
    expect(JSON.stringify(r.audits[0].metadata)).not.toMatch(/checked|HR-1/); // no notes/reference in audit metadata
  });

  it("12. an EXPIRING credential preserves its lifecycle type and expiry", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx, EXPIRING);
      await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER);
      return tx.credential.findFirstOrThrow({ where: { claimVersionId: s.claimVersionId } });
    });
    expect(r.lifecycleType).toBe("EXPIRING");
    expect(r.validUntil?.toISOString()).toBe("2027-03-31T00:00:00.000Z");
  });

  it("a CONTINUING credential is created once, as CONTINUING, with no second PERMANENT credential", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx, CONTINUING);
      await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER);
      return tx.credential.findMany({ where: { organisationId: s.org.id } });
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ lifecycleType: "CONTINUING", validUntil: null, pipelineStatus: "AWAITING_SIGNATURE" });
  });

  it("18. approval creates no Attestation, Anchor, BlockchainTransaction, Revocation or Merkle leaf", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx, CONTINUING);
      await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER);
      const where = { organisationId: s.org.id };
      return {
        attestations: await tx.attestation.count({ where }),
        anchors: await tx.anchor.count({ where }),
        transactions: await tx.blockchainTransaction.count({ where }),
        revocations: await tx.revocation.count({ where }),
        cohortLeaves: await tx.cohortLeaf.count({ where }),
        pulseLeaves: await tx.proofPulseLeaf.count({ where }),
        trees: await tx.proofPulseTree.count({ where }),
      };
    });
    expect(r).toEqual({ attestations: 0, anchors: 0, transactions: 0, revocations: 0, cohortLeaves: 0, pulseLeaves: 0, trees: 0 });
  });

  it("6. a withdrawn request cannot be approved or rejected", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      await withdrawVerificationRequest(tx, s.cand, s.requestId);
      const approve = await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER).catch((e) => e);
      const reject = await rejectVerificationRequest(tx, s.issuer, s.requestId, { rejectionReason: "OTHER", notes: "x" }, LATER).catch((e) => e);
      return { approve, reject, credentials: await tx.credential.count({ where: { claimVersionId: s.claimVersionId } }), decisions: await tx.reviewDecision.count() };
    });
    expect(r.approve).toMatchObject({ code: "CONFLICT" });
    expect(r.reject).toMatchObject({ code: "CONFLICT" });
    expect(r.credentials).toBe(0);
  });

  it("7. a superseded request cannot be approved (the candidate edited the claim)", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      await updateClaim(tx, s.cand, s.claimId, { ...PERMANENT, title: "Senior Software Engineer" }, NOW);
      const request = await tx.verificationRequest.findUniqueOrThrow({ where: { id: s.requestId } });
      const approve = await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER).catch((e) => e);
      return { request, approve, credentials: await tx.credential.count({ where: { claimVersionId: s.claimVersionId } }) };
    });
    expect(r.request.status).toBe("SUPERSEDED");
    expect(r.approve).toMatchObject({ code: "CONFLICT" });
    expect(r.credentials).toBe(0);
  });

  it("an open request on a version that is no longer the current one cannot be approved", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      // Bypass the candidate service to leave the request open on an outdated version.
      await tx.claimVersion.create({
        data: { claimId: s.claimId, versionNumber: 2, content: { title: "Edited", organisationName: "Acme Ltd", startDate: "2022-01-10" }, proposedLifecycleType: "PERMANENT" },
      });
      const view = await getIssuerRequest(tx, s.issuer, s.requestId);
      const approve = await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER).catch((e) => e);
      return { view, approve, status: (await tx.verificationRequest.findUniqueOrThrow({ where: { id: s.requestId } })).status };
    });
    expect(r.view.claimVersion.isCurrentVersion).toBe(false);
    expect(r.approve).toMatchObject({ code: "CONFLICT" });
    expect(r.status).toBe("SUBMITTED");
  });

  it("an EXPIRING version without a usable expiry date cannot be issued", async () => {
    const r = await inRollback(async (tx) => {
      const org = await mkOrg(tx, "ACTIVE");
      const issuer = await issuerOf(tx, org.id);
      const cand = await candidate(tx);
      const claim = await tx.claim.create({ data: { candidateId: cand.userId, category: "CERTIFICATION" } });
      const version = await tx.claimVersion.create({
        data: { claimId: claim.id, versionNumber: 1, content: { title: "Licence" }, proposedLifecycleType: "EXPIRING" },
      });
      const request = await tx.verificationRequest.create({ data: { claimVersionId: version.id, organisationId: org.id, candidateId: cand.userId } });
      const approve = await approveVerificationRequest(tx, issuer, request.id, {}, LATER).catch((e) => e);
      return { approve, status: (await tx.verificationRequest.findUniqueOrThrow({ where: { id: request.id } })).status };
    });
    expect(r.approve).toMatchObject({ code: "CONFLICT" });
    expect(r.status).toBe("SUBMITTED");
  });

  it("13/20. double approval is rejected and leaves exactly one decision and one credential", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER);
      const second = await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER).catch((e) => e);
      return {
        second,
        decisions: await tx.reviewDecision.count({ where: { verificationRequestId: s.requestId } }),
        credentials: await tx.credential.count({ where: { claimVersionId: s.claimVersionId } }),
      };
    });
    expect(r.second).toMatchObject({ code: "CONFLICT" });
    expect(r.decisions).toBe(1);
    expect(r.credentials).toBe(1);
  });

  it("20. approve-then-reject and reject-then-approve: the later decision loses and nothing changes", async () => {
    const r = await inRollback(async (tx) => {
      const a = await setup(tx);
      await approveVerificationRequest(tx, a.issuer, a.requestId, {}, LATER);
      const rejectAfterApprove = await rejectVerificationRequest(tx, a.issuer, a.requestId, { rejectionReason: "OTHER", notes: "x" }, LATER).catch((e) => e);

      const b = await setup(tx);
      await rejectVerificationRequest(tx, b.issuer, b.requestId, { rejectionReason: "DATES_MISMATCH" }, LATER);
      const approveAfterReject = await approveVerificationRequest(tx, b.issuer, b.requestId, {}, LATER).catch((e) => e);

      return {
        rejectAfterApprove,
        approveAfterReject,
        aStatus: (await tx.verificationRequest.findUniqueOrThrow({ where: { id: a.requestId } })).status,
        bStatus: (await tx.verificationRequest.findUniqueOrThrow({ where: { id: b.requestId } })).status,
        bCredentials: await tx.credential.count({ where: { claimVersionId: b.claimVersionId } }),
        decisions: await tx.reviewDecision.count({ where: { verificationRequestId: { in: [a.requestId, b.requestId] } } }),
      };
    });
    expect(r.rejectAfterApprove).toMatchObject({ code: "CONFLICT" });
    expect(r.approveAfterReject).toMatchObject({ code: "CONFLICT" });
    expect(r.aStatus).toBe("APPROVED");
    expect(r.bStatus).toBe("REJECTED");
    expect(r.bCredentials).toBe(0);
    expect(r.decisions).toBe(2);
  });
});

describe("database backstops (14, 15, 20)", () => {
  it("14. a second ReviewDecision for the same request is rejected by the database", async () => {
    await expect(
      inRollback(async (tx) => {
        const s = await setup(tx);
        await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER);
        await tx.reviewDecision.create({
          data: {
            verificationRequestId: s.requestId,
            organisationId: s.org.id,
            reviewerMemberId: s.issuer.memberId!,
            decision: "REJECT",
            rejectionReason: "OTHER",
          },
        });
      }),
    ).rejects.toThrow();
  });

  it("15. a second Credential for the same ClaimVersion is rejected by the database", async () => {
    await expect(
      inRollback(async (tx) => {
        const s = await setup(tx);
        await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER);
        await tx.credential.create({ data: { organisationId: s.org.id, claimVersionId: s.claimVersionId, lifecycleType: "PERMANENT" } });
      }),
    ).rejects.toThrow();
  });

  it("20. a decided request can never change status again (trigger)", async () => {
    await expect(
      inRollback(async (tx) => {
        const s = await setup(tx);
        await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER);
        await tx.verificationRequest.update({ where: { id: s.requestId }, data: { status: "REJECTED" } });
      }),
    ).rejects.toThrow(/cannot change status/);
  });

  it("a decision cannot be edited or deleted (append-only)", async () => {
    await expect(
      inRollback(async (tx) => {
        const s = await setup(tx);
        const { decisionId } = await approveVerificationRequest(tx, s.issuer, s.requestId, {}, LATER);
        await tx.reviewDecision.update({ where: { id: decisionId }, data: { notes: "rewritten" } });
      }),
    ).rejects.toThrow(/append-only/);
  });
});

describe("reject and resubmission (16)", () => {
  it("16. rejection retains the request, claim, version and decision, and creates no credential", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const result = await rejectVerificationRequest(tx, s.issuer, s.requestId, { rejectionReason: "DATES_MISMATCH", notes: "Start date differs", sourceOfTruthReference: "REG-9" }, LATER);
      return {
        s,
        result,
        request: await tx.verificationRequest.findUniqueOrThrow({ where: { id: s.requestId } }),
        decision: await tx.reviewDecision.findUniqueOrThrow({ where: { verificationRequestId: s.requestId } }),
        claim: await tx.claim.findUnique({ where: { id: s.claimId } }),
        versions: await tx.claimVersion.count({ where: { claimId: s.claimId } }),
        credentials: await tx.credential.count({ where: { claimVersionId: s.claimVersionId } }),
        audits: await tx.auditEvent.findMany({ where: { targetId: s.requestId, action: "REQUEST_REJECTED" } }),
        candidateView: await getCandidateClaim(tx, s.cand, s.claimId),
      };
    });
    expect(r.request).toMatchObject({ status: "REJECTED", closedAt: LATER });
    expect(r.decision).toMatchObject({ decision: "REJECT", rejectionReason: "DATES_MISMATCH", notes: "Start date differs", sourceOfTruthReference: "REG-9" });
    expect(r.claim).not.toBeNull();
    expect(r.versions).toBe(1);
    expect(r.credentials).toBe(0);
    expect(r.audits).toHaveLength(1);
    expect(JSON.stringify(r.audits[0].metadata)).not.toMatch(/Start date differs|REG-9/);
    // The candidate still sees the rejected request in history, with its reason code only.
    const shown = r.candidateView.latestVersion?.verificationRequests[0];
    expect(shown).toMatchObject({ id: r.s.requestId, status: "REJECTED", decision: { decision: "REJECT", rejectionReason: "DATES_MISMATCH" } });
  });

  it("a rejection needs a reason code; nothing is written for an invalid one", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const none = await rejectVerificationRequest(tx, s.issuer, s.requestId, {}, LATER).catch((e) => e);
      const bad = await rejectVerificationRequest(tx, s.issuer, s.requestId, { rejectionReason: "BECAUSE" }, LATER).catch((e) => e);
      const other = await rejectVerificationRequest(tx, s.issuer, s.requestId, { rejectionReason: "OTHER" }, LATER).catch((e) => e);
      return { none, bad, other, status: (await tx.verificationRequest.findUniqueOrThrow({ where: { id: s.requestId } })).status, decisions: await tx.reviewDecision.count() };
    });
    for (const e of [r.none, r.bad, r.other]) expect(e).toMatchObject({ code: "VALIDATION" });
    expect(r.status).toBe("SUBMITTED");
  });

  it("after a rejection the candidate can make a fresh request, and the old decision stays", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      await rejectVerificationRequest(tx, s.issuer, s.requestId, { rejectionReason: "TITLE_MISMATCH" }, LATER);
      const again = await submitVerificationRequest(tx, s.cand, { claimId: s.claimId, claimVersionId: s.claimVersionId, organisationId: s.org.id });
      const approved = await approveVerificationRequest(tx, s.issuer, again.requestId, {}, LATER);
      return {
        s,
        again,
        approved,
        requests: await tx.verificationRequest.findMany({ where: { claimVersionId: s.claimVersionId }, orderBy: { submittedAt: "asc" } }),
        decisions: await tx.reviewDecision.findMany({ where: { organisationId: s.org.id }, orderBy: { decidedAt: "asc" } }),
      };
    });
    expect(r.again.requestId).not.toBe(r.s.requestId);
    expect(r.requests.map((x) => x.status)).toEqual(["REJECTED", "APPROVED"]);
    expect(r.decisions.map((d) => d.decision)).toEqual(["REJECT", "APPROVE"]);
  });
});

describe("self-review (SECURITY_MODEL T11)", () => {
  async function ownClaimRequest(tx: Tx) {
    const org = await mkOrg(tx, "ACTIVE");
    const issuer = await issuerOf(tx, org.id);
    const claim = await tx.claim.create({ data: { candidateId: issuer.userId, category: "EXPERIENCE" } });
    const version = await tx.claimVersion.create({
      data: { claimId: claim.id, versionNumber: 1, content: { title: "Mine", organisationName: "Acme", startDate: "2020-01-01", endDate: "2021-01-01" }, proposedLifecycleType: "PERMANENT" },
    });
    const request = await tx.verificationRequest.create({ data: { claimVersionId: version.id, organisationId: org.id, candidateId: issuer.userId } });
    return { org, issuer, version, request };
  }

  it("the service refuses to approve or reject the reviewer's own claim", async () => {
    const r = await inRollback(async (tx) => {
      const s = await ownClaimRequest(tx);
      const view = await getIssuerRequest(tx, s.issuer, s.request.id);
      const approve = await approveVerificationRequest(tx, s.issuer, s.request.id, {}, LATER).catch((e) => e);
      const reject = await rejectVerificationRequest(tx, s.issuer, s.request.id, { rejectionReason: "OTHER", notes: "x" }, LATER).catch((e) => e);
      return { view, approve, reject, credentials: await tx.credential.count({ where: { claimVersionId: s.version.id } }) };
    });
    expect(r.view.isOwnClaim).toBe(true);
    expect(r.approve).toMatchObject({ code: "FORBIDDEN" });
    expect(r.reject).toMatchObject({ code: "FORBIDDEN" });
    expect(r.credentials).toBe(0);
  });

  it("the database trigger refuses a self-review even if the service check were bypassed", async () => {
    await expect(
      inRollback(async (tx) => {
        const s = await ownClaimRequest(tx);
        await tx.reviewDecision.create({
          data: { verificationRequestId: s.request.id, organisationId: s.org.id, reviewerMemberId: s.issuer.memberId!, decision: "APPROVE" },
        });
      }),
    ).rejects.toThrow(/own claim/);
  });
});

describe("candidate-facing reads never expose reviewer-private data (17)", () => {
  it("17. notes and source-of-truth references are not in any candidate read", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      await rejectVerificationRequest(tx, s.issuer, s.requestId, { rejectionReason: "OTHER", notes: "PRIVATE-NOTE-123", sourceOfTruthReference: "PRIVATE-REF-456" }, LATER);
      const again = await submitVerificationRequest(tx, s.cand, { claimId: s.claimId, claimVersionId: s.claimVersionId, organisationId: s.org.id });
      await approveVerificationRequest(tx, s.issuer, again.requestId, { notes: "PRIVATE-NOTE-789", sourceOfTruthReference: "PRIVATE-REF-012" }, LATER);
      return {
        detail: JSON.stringify(await getCandidateClaim(tx, s.cand, s.claimId)),
        list: JSON.stringify(await listCandidateClaims(tx, s.cand)),
      };
    });
    for (const text of [r.detail, r.list]) {
      expect(text).not.toMatch(/PRIVATE-NOTE|PRIVATE-REF|sourceOfTruthReference|"notes"/);
      expect(text).toMatch(/OTHER/); // the reason code the candidate IS allowed to see
    }
  });

  it("other candidates and issuers of other organisations cannot read the decision either", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      await rejectVerificationRequest(tx, s.issuer, s.requestId, { rejectionReason: "OTHER", notes: "PRIVATE-NOTE-123" }, LATER);
      const other = await mkOrg(tx, "ACTIVE");
      const otherIssuer = await issuerOf(tx, other.id);
      const stranger = await candidate(tx);
      return {
        strangerRead: await getCandidateClaim(tx, stranger, s.claimId).catch((e) => e),
        otherIssuerRead: await getIssuerRequest(tx, otherIssuer, s.requestId).catch((e) => e),
      };
    });
    expect(r.strangerRead).toMatchObject({ code: "NOT_FOUND" });
    expect(r.otherIssuerRead).toMatchObject({ code: "NOT_FOUND" });
  });

  it("the issuing organisation can read its own notes and reference", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      await approveVerificationRequest(tx, s.issuer, s.requestId, { notes: "n", sourceOfTruthReference: "ref" }, LATER);
      return getIssuerRequest(tx, s.issuer, s.requestId);
    });
    expect(r.decision).toMatchObject({ decision: "APPROVE", notes: "n", sourceOfTruthReference: "ref" });
    expect(r.claimVersion.credential).toMatchObject({ pipelineStatus: "AWAITING_SIGNATURE", lifecycleType: "PERMANENT" });
  });
});
