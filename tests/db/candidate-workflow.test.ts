import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/authorize";
import {
  createClaim,
  getCandidateClaim,
  listCandidateClaims,
  submitVerificationRequest,
  updateClaim,
  withdrawVerificationRequest,
} from "@/server/candidate/claims";
import { db, inRollback, mkCredential, mkOrg, mkUser, type Tx } from "./helpers";

afterAll(async () => {
  await db.$disconnect();
});

const NOW = new Date("2026-10-15T12:00:00Z");

const DRAFT = {
  category: "EXPERIENCE",
  lifecycleType: "PERMANENT",
  title: "Software Engineer",
  organisationName: "Acme Ltd",
  startDate: "2022-01-10",
  endDate: "2024-03-31",
};

const asActor = (userId: string): Actor => ({
  userId,
  authUserId: randomUUID(),
  role: "CANDIDATE",
  organisationId: null,
  organisationStatus: null,
  memberId: null,
});

async function candidate(tx: Tx) {
  const user = await mkUser(tx, "CANDIDATE");
  return asActor(user.id);
}

async function claimFor(tx: Tx, actor: Actor, overrides: Record<string, unknown> = {}) {
  return createClaim(tx, actor, { ...DRAFT, ...overrides }, NOW);
}

async function requestFor(tx: Tx, actor: Actor, claimId: string, claimVersionId: string, organisationId: string) {
  return submitVerificationRequest(tx, actor, { claimId, claimVersionId, organisationId });
}

describe("claims", () => {
  it("3. creating a claim creates version 1, owned by the authenticated candidate, with an audit event", async () => {
    const result = await inRollback(async (tx) => {
      const actor = await candidate(tx);
      const { claimId, claimVersionId } = await claimFor(tx, actor);
      return {
        actor,
        claimVersionId,
        claim: await tx.claim.findUnique({ where: { id: claimId }, include: { versions: true } }),
        audits: await tx.auditEvent.findMany({ where: { targetId: claimId, action: "CLAIM_CREATED" } }),
        credentials: await tx.credential.count({ where: { claimVersionId } }),
      };
    });
    expect(result.claim?.candidateId).toBe(result.actor.userId);
    expect(result.claim?.versions).toHaveLength(1);
    expect(result.claim?.versions[0]).toMatchObject({ versionNumber: 1, authoredBy: "CANDIDATE", proposedLifecycleType: "PERMANENT" });
    expect(result.audits).toHaveLength(1);
    expect(result.credentials).toBe(0); // 12: no Credential at candidate level
  });

  it("rejects invalid drafts with field errors and creates nothing (6, 7)", async () => {
    await expect(
      inRollback(async (tx) => claimFor(tx, await candidate(tx), { lifecycleType: "EXPIRING", endDate: "" })),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { expiryDate: expect.any(String) } });
    await expect(inRollback(async (tx) => claimFor(tx, await candidate(tx), { endDate: "2021-01-01" }))).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("4/5. editing creates version 2 and leaves version 1 unchanged", async () => {
    const r = await inRollback(async (tx) => {
      const actor = await candidate(tx);
      const { claimId } = await claimFor(tx, actor);
      const v1Before = await tx.claimVersion.findFirstOrThrow({ where: { claimId, versionNumber: 1 } });
      const edit = await updateClaim(tx, actor, claimId, { ...DRAFT, title: "Senior Software Engineer" }, NOW);
      const versions = await tx.claimVersion.findMany({ where: { claimId }, orderBy: { versionNumber: "asc" } });
      return { v1Before, edit, versions };
    });
    expect(r.edit).toMatchObject({ changed: true, versionNumber: 2 });
    expect(r.versions).toHaveLength(2);
    expect(r.versions[0]).toEqual(r.v1Before); // byte-for-byte the same row
    expect((r.versions[0].content as { title: string }).title).toBe("Software Engineer");
    expect((r.versions[1].content as { title: string }).title).toBe("Senior Software Engineer");
  });

  it("an edit that changes nothing creates no new version", async () => {
    const r = await inRollback(async (tx) => {
      const actor = await candidate(tx);
      const { claimId } = await claimFor(tx, actor);
      const edit = await updateClaim(tx, actor, claimId, { ...DRAFT }, NOW);
      return { edit, count: await tx.claimVersion.count({ where: { claimId } }) };
    });
    expect(r.edit.changed).toBe(false);
    expect(r.count).toBe(1);
  });

  it("an edit cannot change the category of a claim", async () => {
    const category = await inRollback(async (tx) => {
      const actor = await candidate(tx);
      const { claimId } = await claimFor(tx, actor);
      await updateClaim(tx, actor, claimId, { ...DRAFT, category: "EDUCATION", title: "Changed" }, NOW);
      return (await tx.claim.findUniqueOrThrow({ where: { id: claimId } })).category;
    });
    expect(category).toBe("EXPERIENCE");
  });
});

describe("2/11. candidates cannot touch each other's data", () => {
  it("cannot read, edit or request verification of another candidate's claim", async () => {
    const outcome = await inRollback(async (tx) => {
      const owner = await candidate(tx);
      const other = await candidate(tx);
      const org = await mkOrg(tx, "ACTIVE");
      const { claimId, claimVersionId } = await claimFor(tx, owner);

      const attempt = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return "allowed";
        } catch (e) {
          return (e as { code?: string }).code ?? "error";
        }
      };
      // Each attempt runs in a savepoint-free way: they fail before any write.
      return {
        read: await attempt(() => getCandidateClaim(tx, other, claimId)),
        edit: await attempt(() => updateClaim(tx, other, claimId, { ...DRAFT, title: "Hijacked" }, NOW)),
        submit: await attempt(() => requestFor(tx, other, claimId, claimVersionId, org.id)),
        listed: (await listCandidateClaims(tx, other)).map((c) => c.id),
        versions: await tx.claimVersion.count({ where: { claimId } }),
      };
    });
    expect(outcome).toMatchObject({ read: "NOT_FOUND", edit: "NOT_FOUND", submit: "NOT_FOUND", listed: [], versions: 1 });
  });

  it("cannot withdraw another candidate's request", async () => {
    const code = await inRollback(async (tx) => {
      const owner = await candidate(tx);
      const other = await candidate(tx);
      const org = await mkOrg(tx, "ACTIVE");
      const { claimId, claimVersionId } = await claimFor(tx, owner);
      const { requestId } = await requestFor(tx, owner, claimId, claimVersionId, org.id);
      try {
        await withdrawVerificationRequest(tx, other, requestId);
        return "allowed";
      } catch (e) {
        return (e as { code?: string }).code;
      }
    });
    expect(code).toBe("NOT_FOUND");
  });

  it("an owner's list only contains their own claims", async () => {
    const ids = await inRollback(async (tx) => {
      const a = await candidate(tx);
      const b = await candidate(tx);
      const { claimId: ca } = await claimFor(tx, a);
      const { claimId: cb } = await claimFor(tx, b);
      return { listA: (await listCandidateClaims(tx, a)).map((c) => c.id), ca, cb };
    });
    expect(ids.listA).toEqual([ids.ca]);
    expect(ids.listA).not.toContain(ids.cb);
  });
});

describe("verification requests", () => {
  it("8. a request references the exact ClaimVersion, starts SUBMITTED, and creates no Credential", async () => {
    const r = await inRollback(async (tx) => {
      const actor = await candidate(tx);
      const org = await mkOrg(tx, "ACTIVE");
      const { claimId, claimVersionId } = await claimFor(tx, actor);
      const { requestId } = await requestFor(tx, actor, claimId, claimVersionId, org.id);
      return {
        claimVersionId,
        orgId: org.id,
        actor,
        request: await tx.verificationRequest.findUniqueOrThrow({ where: { id: requestId } }),
        claim: await tx.claim.findUniqueOrThrow({ where: { id: claimId } }),
        credentials: await tx.credential.count({ where: { claimVersionId } }),
        decisions: await tx.reviewDecision.count({ where: { verificationRequestId: requestId } }),
      };
    });
    expect(r.request).toMatchObject({ claimVersionId: r.claimVersionId, organisationId: r.orgId, candidateId: r.actor.userId, status: "SUBMITTED" });
    expect(r.claim.organisationId).toBe(r.orgId);
    expect(r.credentials).toBe(0);
    expect(r.decisions).toBe(0);
  });

  it("9. a second open request for the same ClaimVersion is rejected", async () => {
    await expect(
      inRollback(async (tx) => {
        const actor = await candidate(tx);
        const org = await mkOrg(tx, "ACTIVE");
        const { claimId, claimVersionId } = await claimFor(tx, actor);
        await requestFor(tx, actor, claimId, claimVersionId, org.id);
        await requestFor(tx, actor, claimId, claimVersionId, org.id);
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("14. the organisation must exist and be ACTIVE", async () => {
    for (const status of ["SUSPENDED", "PENDING_ONBOARDING"] as const) {
      await expect(
        inRollback(async (tx) => {
          const actor = await candidate(tx);
          const org = await mkOrg(tx, status);
          const { claimId, claimVersionId } = await claimFor(tx, actor);
          await requestFor(tx, actor, claimId, claimVersionId, org.id);
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await expect(
      inRollback(async (tx) => {
        const actor = await candidate(tx);
        const { claimId, claimVersionId } = await claimFor(tx, actor);
        await requestFor(tx, actor, claimId, claimVersionId, randomUUID());
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      inRollback(async (tx) => {
        const actor = await candidate(tx);
        const { claimId, claimVersionId } = await claimFor(tx, actor);
        await requestFor(tx, actor, claimId, claimVersionId, "not-a-uuid");
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("a version that belongs to a different claim is refused", async () => {
    await expect(
      inRollback(async (tx) => {
        const actor = await candidate(tx);
        const org = await mkOrg(tx, "ACTIVE");
        const first = await claimFor(tx, actor);
        const second = await claimFor(tx, actor, { title: "Another" });
        await requestFor(tx, actor, first.claimId, second.claimVersionId, org.id);
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("only the latest version can be submitted", async () => {
    await expect(
      inRollback(async (tx) => {
        const actor = await candidate(tx);
        const org = await mkOrg(tx, "ACTIVE");
        const { claimId, claimVersionId: v1 } = await claimFor(tx, actor);
        await updateClaim(tx, actor, claimId, { ...DRAFT, title: "Newer" }, NOW);
        await requestFor(tx, actor, claimId, v1, org.id);
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a claim already linked to one organisation cannot be sent to another", async () => {
    await expect(
      inRollback(async (tx) => {
        const actor = await candidate(tx);
        const a = await mkOrg(tx, "ACTIVE");
        const b = await mkOrg(tx, "ACTIVE");
        const { claimId, claimVersionId } = await claimFor(tx, actor);
        const { requestId } = await requestFor(tx, actor, claimId, claimVersionId, a.id);
        await withdrawVerificationRequest(tx, actor, requestId);
        await requestFor(tx, actor, claimId, claimVersionId, b.id);
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("10. a rejected request stays in history, the claim and version are kept, and a new request is allowed", async () => {
    const r = await inRollback(async (tx) => {
      const actor = await candidate(tx);
      const org = await mkOrg(tx, "ACTIVE");
      const reviewer = await mkUser(tx, "ISSUER");
      const member = await tx.organisationMember.create({ data: { userId: reviewer.id, organisationId: org.id, status: "ACTIVE" } });
      const { claimId, claimVersionId } = await claimFor(tx, actor);
      const { requestId } = await requestFor(tx, actor, claimId, claimVersionId, org.id);

      // Simulate the (Phase 5) issuer rejecting it.
      await tx.reviewDecision.create({
        data: {
          verificationRequestId: requestId,
          organisationId: org.id,
          reviewerMemberId: member.id,
          decision: "REJECT",
          rejectionReason: "DATES_MISMATCH",
          notes: "internal reviewer note",
          sourceOfTruthReference: "HR-ROW-77",
        },
      });
      await tx.verificationRequest.update({ where: { id: requestId }, data: { status: "REJECTED", closedAt: new Date() } });

      const view = await getCandidateClaim(tx, actor, claimId);
      const again = await requestFor(tx, actor, claimId, claimVersionId, org.id);
      return {
        requestId,
        again,
        view,
        claimExists: !!(await tx.claim.findUnique({ where: { id: claimId } })),
        versionCount: await tx.claimVersion.count({ where: { claimId } }),
        requestCount: await tx.verificationRequest.count({ where: { claimVersionId } }),
      };
    });
    const firstRequest = r.view.versions[0].verificationRequests.find((x) => x.id === r.requestId);
    expect(firstRequest).toMatchObject({ status: "REJECTED", decision: { decision: "REJECT", rejectionReason: "DATES_MISMATCH" } });
    // The candidate sees the reason code, never internal notes or source-of-truth references.
    expect(JSON.stringify(r.view)).not.toMatch(/internal reviewer note|HR-ROW-77|sourceOfTruthReference|"notes"/);
    expect(r.claimExists).toBe(true);
    expect(r.versionCount).toBe(1);
    expect(r.requestCount).toBe(2);
    expect(r.again.status).toBe("SUBMITTED");
  });

  it("editing supersedes an open request, which is kept in history", async () => {
    const r = await inRollback(async (tx) => {
      const actor = await candidate(tx);
      const org = await mkOrg(tx, "ACTIVE");
      const { claimId, claimVersionId } = await claimFor(tx, actor);
      const { requestId } = await requestFor(tx, actor, claimId, claimVersionId, org.id);
      const edit = await updateClaim(tx, actor, claimId, { ...DRAFT, title: "Lead Engineer" }, NOW);
      return {
        edit,
        request: await tx.verificationRequest.findUniqueOrThrow({ where: { id: requestId } }),
        oldVersionId: claimVersionId,
        audits: await tx.auditEvent.count({ where: { action: "REQUEST_SUPERSEDED", targetId: requestId } }),
      };
    });
    expect(r.edit.supersededRequests).toBe(1);
    expect(r.request).toMatchObject({ status: "SUPERSEDED", claimVersionId: r.oldVersionId });
    expect(r.request.closedAt).not.toBeNull();
    expect(r.audits).toBe(1);
  });

  it("withdrawing an open request keeps the row; closed requests cannot be withdrawn", async () => {
    const r = await inRollback(async (tx) => {
      const actor = await candidate(tx);
      const org = await mkOrg(tx, "ACTIVE");
      const { claimId, claimVersionId } = await claimFor(tx, actor);
      const { requestId } = await requestFor(tx, actor, claimId, claimVersionId, org.id);
      const first = await withdrawVerificationRequest(tx, actor, requestId);
      let second = "allowed";
      try {
        await withdrawVerificationRequest(tx, actor, requestId);
      } catch (e) {
        second = (e as { code?: string }).code ?? "error";
      }
      return { first, second, row: await tx.verificationRequest.findUniqueOrThrow({ where: { id: requestId } }) };
    });
    expect(r.first.status).toBe("WITHDRAWN");
    expect(r.second).toBe("CONFLICT");
    expect(r.row).toMatchObject({ status: "WITHDRAWN" });
    expect(r.row.closedAt).not.toBeNull();
  });

  it("an already-approved version cannot be requested again", async () => {
    await expect(
      inRollback(async (tx) => {
        const actor = await candidate(tx);
        const org = await mkOrg(tx, "ACTIVE");
        const { claimId, claimVersionId } = await claimFor(tx, actor);
        const { requestId } = await requestFor(tx, actor, claimId, claimVersionId, org.id);
        await tx.verificationRequest.update({ where: { id: requestId }, data: { status: "APPROVED", closedAt: new Date() } });
        await requestFor(tx, actor, claimId, claimVersionId, org.id);
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a version that already has a Credential cannot be requested again", async () => {
    await expect(
      inRollback(async (tx) => {
        const actor = await candidate(tx);
        const org = await mkOrg(tx, "ACTIVE");
        const { claimId, claimVersionId } = await claimFor(tx, actor);
        await mkCredential(tx, org.id, claimVersionId);
        await requestFor(tx, actor, claimId, claimVersionId, org.id);
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("13. listing never exposes a stored verification state", async () => {
    const claims = await inRollback(async (tx) => {
      const actor = await candidate(tx);
      await claimFor(tx, actor);
      return listCandidateClaims(tx, actor);
    });
    expect(JSON.stringify(claims)).not.toMatch(/verified|verificationState|trust|reputation|score/i);
  });
});
