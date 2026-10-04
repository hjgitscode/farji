import { afterAll, describe, expect, it } from "vitest";
import {
  ZERO_HASH,
  address,
  bytes32,
  db,
  inRollback,
  mkClaimVersion,
  mkConfirmedTx,
  mkCredential,
  mkIssuerKey,
  mkOrg,
  mkUser,
  type Tx,
} from "./helpers";

afterAll(async () => {
  await db.$disconnect();
});

const UNIQUE = /unique|duplicate/i;
const FK = /foreign key/i;

async function mkMember(tx: Tx, organisationId: string) {
  const user = await mkUser(tx, "ISSUER");
  const member = await tx.organisationMember.create({ data: { userId: user.id, organisationId, status: "ACTIVE" } });
  return { user, member };
}

describe("claims and requests", () => {
  it("1. rejects a duplicate ClaimVersion number", async () => {
    await expect(
      inRollback(async (tx) => {
        const candidate = await mkUser(tx, "CANDIDATE");
        const { claim } = await mkClaimVersion(tx, candidate.id);
        await tx.claimVersion.create({
          data: { claimId: claim.id, versionNumber: 1, content: {}, proposedLifecycleType: "PERMANENT" },
        });
      }),
    ).rejects.toThrow(UNIQUE);
  });

  it("2. rejects a second open verification request for one ClaimVersion", async () => {
    await expect(
      inRollback(async (tx) => {
        const candidate = await mkUser(tx, "CANDIDATE");
        const org = await mkOrg(tx);
        const { version } = await mkClaimVersion(tx, candidate.id);
        const data = { claimVersionId: version.id, organisationId: org.id, candidateId: candidate.id };
        await tx.verificationRequest.create({ data });
        await tx.verificationRequest.create({ data });
      }),
    ).rejects.toThrow(UNIQUE);
  });

  it("keeps the claim after a rejection and allows a fresh request afterwards", async () => {
    const claimStillThere = await inRollback(async (tx) => {
      const candidate = await mkUser(tx, "CANDIDATE");
      const org = await mkOrg(tx);
      const { member } = await mkMember(tx, org.id);
      const { claim, version } = await mkClaimVersion(tx, candidate.id);
      const data = { claimVersionId: version.id, organisationId: org.id, candidateId: candidate.id };
      const req = await tx.verificationRequest.create({ data });
      await tx.reviewDecision.create({
        data: {
          verificationRequestId: req.id,
          organisationId: org.id,
          reviewerMemberId: member.id,
          decision: "REJECT",
          rejectionReason: "DATES_MISMATCH",
        },
      });
      await tx.verificationRequest.update({ where: { id: req.id }, data: { status: "REJECTED", closedAt: new Date() } });
      await tx.verificationRequest.create({ data });
      return tx.claim.findUnique({ where: { id: claim.id } });
    });
    expect(claimStillThere).not.toBeNull();
  });

  it("rejects a second ReviewDecision for one request", async () => {
    await expect(
      inRollback(async (tx) => {
        const candidate = await mkUser(tx, "CANDIDATE");
        const org = await mkOrg(tx);
        const { member } = await mkMember(tx, org.id);
        const { version } = await mkClaimVersion(tx, candidate.id);
        const req = await tx.verificationRequest.create({
          data: { claimVersionId: version.id, organisationId: org.id, candidateId: candidate.id },
        });
        const data = {
          verificationRequestId: req.id,
          organisationId: org.id,
          reviewerMemberId: member.id,
          decision: "APPROVE" as const,
        };
        await tx.reviewDecision.create({ data });
        await tx.reviewDecision.create({ data });
      }),
    ).rejects.toThrow(UNIQUE);
  });

  it("rejects a reviewer who belongs to another organisation", async () => {
    await expect(
      inRollback(async (tx) => {
        const candidate = await mkUser(tx, "CANDIDATE");
        const orgA = await mkOrg(tx);
        const orgB = await mkOrg(tx);
        const { member: memberOfB } = await mkMember(tx, orgB.id);
        const { version } = await mkClaimVersion(tx, candidate.id);
        const req = await tx.verificationRequest.create({
          data: { claimVersionId: version.id, organisationId: orgA.id, candidateId: candidate.id },
        });
        await tx.reviewDecision.create({
          data: { verificationRequestId: req.id, organisationId: orgA.id, reviewerMemberId: memberOfB.id, decision: "APPROVE" },
        });
      }),
    ).rejects.toThrow(FK);
  });

  it("does not allow a non-ISSUER user to be an organisation member", async () => {
    await expect(
      inRollback(async (tx) => {
        const candidate = await mkUser(tx, "CANDIDATE");
        const org = await mkOrg(tx);
        await tx.organisationMember.create({ data: { userId: candidate.id, organisationId: org.id } });
      }),
    ).rejects.toThrow(/only ISSUER/);
  });
});

describe("issuer keys", () => {
  it("5. rejects a duplicate issuer wallet address, even for another organisation", async () => {
    await expect(
      inRollback(async (tx) => {
        const wallet = address();
        await mkIssuerKey(tx, (await mkOrg(tx)).id, wallet);
        await mkIssuerKey(tx, (await mkOrg(tx)).id, wallet);
      }),
    ).rejects.toThrow(UNIQUE);
  });

  it("never allows a retired wallet to be re-authorised", async () => {
    await expect(
      inRollback(async (tx) => {
        const org = await mkOrg(tx);
        const wallet = address();
        const key = await mkIssuerKey(tx, org.id, wallet);
        await tx.issuerKey.update({ where: { id: key.id }, data: { validUntil: new Date("2026-06-01T00:00:00Z") } });
        await mkIssuerKey(tx, org.id, wallet);
      }),
    ).rejects.toThrow(UNIQUE);
  });

  it("does not allow a retired key to be reopened", async () => {
    await expect(
      inRollback(async (tx) => {
        const key = await mkIssuerKey(tx, (await mkOrg(tx)).id);
        await tx.issuerKey.update({ where: { id: key.id }, data: { validUntil: new Date("2026-06-01T00:00:00Z") } });
        await tx.issuerKey.update({ where: { id: key.id }, data: { validUntil: null } });
      }),
    ).rejects.toThrow(/write-once/);
  });

  it("does not allow a key to move to another organisation", async () => {
    await expect(
      inRollback(async (tx) => {
        const key = await mkIssuerKey(tx, (await mkOrg(tx)).id);
        const other = await mkOrg(tx);
        await tx.issuerKey.update({ where: { id: key.id }, data: { organisationId: other.id } });
      }),
    ).rejects.toThrow(/immutable/);
  });
});

describe("organisation-scoped revocation", () => {
  async function setup(tx: Tx) {
    const candidate = await mkUser(tx, "CANDIDATE");
    const issuer = await mkUser(tx, "ISSUER");
    const orgA = await mkOrg(tx);
    const orgB = await mkOrg(tx);
    const keyA = await mkIssuerKey(tx, orgA.id);
    const keyB = await mkIssuerKey(tx, orgB.id);
    const { version } = await mkClaimVersion(tx, candidate.id);
    const credentialOfA = await mkCredential(tx, orgA.id, version.id);
    const confirmed = await mkConfirmedTx(tx, "REVOKE_CREDENTIAL", issuer.id, orgA.id);
    return { issuer, orgA, orgB, keyA, keyB, credentialOfA, confirmed };
  }

  it("accepts a revocation by the issuing organisation (control case)", async () => {
    const row = await inRollback(async (tx) => {
      const s = await setup(tx);
      return tx.revocation.create({
        data: {
          credentialRowId: s.credentialOfA.id,
          organisationId: s.orgA.id,
          revokerKeyId: s.keyA.id,
          reasonCode: "FRAUD",
          transactionId: s.confirmed.id,
          blockNumber: 1n,
          revokedAt: new Date(),
        },
      });
    });
    expect(row.reasonCode).toBe("FRAUD");
  });

  it("4. rejects a revocation row naming another organisation's credential", async () => {
    await expect(
      inRollback(async (tx) => {
        const s = await setup(tx);
        await tx.revocation.create({
          data: {
            credentialRowId: s.credentialOfA.id,
            organisationId: s.orgB.id,
            revokerKeyId: s.keyB.id,
            reasonCode: "FRAUD",
            transactionId: s.confirmed.id,
            blockNumber: 1n,
            revokedAt: new Date(),
          },
        });
      }),
    ).rejects.toThrow(FK);
  });

  it("rejects a revocation signed by another organisation's key", async () => {
    await expect(
      inRollback(async (tx) => {
        const s = await setup(tx);
        await tx.revocation.create({
          data: {
            credentialRowId: s.credentialOfA.id,
            organisationId: s.orgA.id,
            revokerKeyId: s.keyB.id,
            reasonCode: "FRAUD",
            transactionId: s.confirmed.id,
            blockNumber: 1n,
            revokedAt: new Date(),
          },
        });
      }),
    ).rejects.toThrow(FK);
  });

  it("rejects a second revocation of the same credential", async () => {
    await expect(
      inRollback(async (tx) => {
        const s = await setup(tx);
        const second = await mkConfirmedTx(tx, "REVOKE_CREDENTIAL", s.issuer.id, s.orgA.id);
        const base = {
          credentialRowId: s.credentialOfA.id,
          organisationId: s.orgA.id,
          revokerKeyId: s.keyA.id,
          reasonCode: "FRAUD" as const,
          blockNumber: 1n,
          revokedAt: new Date(),
        };
        await tx.revocation.create({ data: { ...base, transactionId: s.confirmed.id } });
        await tx.revocation.create({ data: { ...base, transactionId: second.id } });
      }),
    ).rejects.toThrow(UNIQUE);
  });

  it("will not record a revocation from a transaction that is not yet observed", async () => {
    await expect(
      inRollback(async (tx) => {
        const s = await setup(tx);
        const pending = await tx.blockchainTransaction.create({
          data: {
            chainId: 31337,
            txHash: bytes32(),
            purpose: "REVOKE_CREDENTIAL",
            targetType: "CREDENTIAL",
            targetId: s.credentialOfA.id,
            fromAddress: address(),
            initiatedByUserId: s.issuer.id,
            organisationId: s.orgA.id,
          },
        });
        await tx.revocation.create({
          data: {
            credentialRowId: s.credentialOfA.id,
            organisationId: s.orgA.id,
            revokerKeyId: s.keyA.id,
            reasonCode: "FRAUD",
            transactionId: pending.id,
            blockNumber: 1n,
            revokedAt: new Date(),
          },
        });
      }),
    ).rejects.toThrow(/CONFIRMED or FINALIZED/);
  });
});

describe("ProofPulse and anchor chains", () => {
  it("3. rejects a second ProofPulse tree for one organisation", async () => {
    await expect(
      inRollback(async (tx) => {
        const org = await mkOrg(tx);
        await tx.proofPulseTree.create({ data: { organisationId: org.id } });
        await tx.proofPulseTree.create({ data: { organisationId: org.id } });
      }),
    ).rejects.toThrow(UNIQUE);
  });

  it("rejects a duplicate leafIndex within a tree", async () => {
    await expect(
      inRollback(async (tx) => {
        const org = await mkOrg(tx);
        const tree = await tx.proofPulseTree.create({ data: { organisationId: org.id } });
        const candidate = await mkUser(tx, "CANDIDATE");
        const a = await mkClaimVersion(tx, candidate.id, "CONTINUING");
        const b = await mkClaimVersion(tx, candidate.id, "CONTINUING");
        const ca = await mkCredential(tx, org.id, a.version.id, "CONTINUING");
        const cb = await mkCredential(tx, org.id, b.version.id, "CONTINUING");
        const base = { treeId: tree.id, organisationId: org.id, leafIndex: 0, scope: "EMPLOYMENT" as const, statusEffectiveAt: new Date() };
        await tx.proofPulseLeaf.create({ data: { ...base, credentialRowId: ca.id } });
        await tx.proofPulseLeaf.create({ data: { ...base, credentialRowId: cb.id } });
      }),
    ).rejects.toThrow(UNIQUE);
  });

  it("only allows CONTINUING credentials to have a ProofPulse leaf", async () => {
    await expect(
      inRollback(async (tx) => {
        const org = await mkOrg(tx);
        const tree = await tx.proofPulseTree.create({ data: { organisationId: org.id } });
        const candidate = await mkUser(tx, "CANDIDATE");
        const { version } = await mkClaimVersion(tx, candidate.id, "PERMANENT");
        const cred = await mkCredential(tx, org.id, version.id, "PERMANENT");
        await tx.proofPulseLeaf.create({
          data: { treeId: tree.id, organisationId: org.id, credentialRowId: cred.id, leafIndex: 0, scope: "EMPLOYMENT", statusEffectiveAt: new Date() },
        });
      }),
    ).rejects.toThrow(/only CONTINUING/);
  });

  it("never lets an ENDED leaf become ACTIVE again", async () => {
    await expect(
      inRollback(async (tx) => {
        const org = await mkOrg(tx);
        const tree = await tx.proofPulseTree.create({ data: { organisationId: org.id } });
        const candidate = await mkUser(tx, "CANDIDATE");
        const { version } = await mkClaimVersion(tx, candidate.id, "CONTINUING");
        const cred = await mkCredential(tx, org.id, version.id, "CONTINUING");
        const leaf = await tx.proofPulseLeaf.create({
          data: { treeId: tree.id, organisationId: org.id, credentialRowId: cred.id, leafIndex: 0, scope: "EMPLOYMENT", statusEffectiveAt: new Date() },
        });
        await tx.proofPulseLeaf.update({ where: { id: leaf.id }, data: { status: "ENDED", statusSeq: 2 } });
        await tx.proofPulseLeaf.update({ where: { id: leaf.id }, data: { status: "ACTIVE", statusSeq: 3 } });
      }),
    ).rejects.toThrow(/ENDED/);
  });

  it("8. lets COHORT and PROOF_PULSE chains coexist at epoch 1 for one organisation", async () => {
    const anchors = await inRollback(async (tx) => {
      const user = await mkUser(tx, "ISSUER");
      const org = await mkOrg(tx);
      const key = await mkIssuerKey(tx, org.id);
      const cohortTx = await mkConfirmedTx(tx, "ANCHOR_COHORT", user.id, org.id);
      const pulseTx = await mkConfirmedTx(tx, "ANCHOR_PROOF_PULSE", user.id, org.id);
      const common = {
        organisationId: org.id,
        epoch: 1,
        previousChainRoot: ZERO_HASH,
        anchorerKeyId: key.id,
        blockNumber: 1n,
        blockTimestamp: new Date(),
        leafCount: 1,
      };
      await tx.anchor.create({
        data: { ...common, attestationType: "COHORT", batchRoot: bytes32(), chainRoot: bytes32(), transactionId: cohortTx.id },
      });
      await tx.anchor.create({
        data: { ...common, attestationType: "PROOF_PULSE", rootSeq: 3, batchRoot: bytes32(), chainRoot: bytes32(), transactionId: pulseTx.id },
      });
      return tx.anchor.findMany({ where: { organisationId: org.id }, select: { attestationType: true, epoch: true } });
    });
    expect(anchors).toHaveLength(2);
    expect(new Set(anchors.map((a) => a.attestationType))).toEqual(new Set(["COHORT", "PROOF_PULSE"]));
    expect(anchors.every((a) => a.epoch === 1)).toBe(true);
  });

  it("never lets one chain fork at the same epoch", async () => {
    await expect(
      inRollback(async (tx) => {
        const user = await mkUser(tx, "ISSUER");
        const org = await mkOrg(tx);
        const key = await mkIssuerKey(tx, org.id);
        const t1 = await mkConfirmedTx(tx, "ANCHOR_COHORT", user.id, org.id);
        const t2 = await mkConfirmedTx(tx, "ANCHOR_COHORT", user.id, org.id);
        const common = {
          organisationId: org.id,
          epoch: 1,
          previousChainRoot: ZERO_HASH,
          anchorerKeyId: key.id,
          blockNumber: 1n,
          blockTimestamp: new Date(),
          leafCount: 1,
          attestationType: "COHORT" as const,
        };
        await tx.anchor.create({ data: { ...common, batchRoot: bytes32(), chainRoot: bytes32(), transactionId: t1.id } });
        await tx.anchor.create({ data: { ...common, batchRoot: bytes32(), chainRoot: bytes32(), transactionId: t2.id } });
      }),
    ).rejects.toThrow(UNIQUE);
  });
});

describe("blockchain transactions", () => {
  const base = (userId: string) => ({
    chainId: 1,
    txHash: bytes32(),
    purpose: "ANCHOR_COHORT" as const,
    targetType: "COHORT_BATCH" as const,
    targetId: userId,
    fromAddress: address(),
    initiatedByUserId: userId,
  });

  it("cannot be inserted as FINALIZED", async () => {
    await expect(
      inRollback(async (tx) => {
        const user = await mkUser(tx, "ISSUER");
        await tx.blockchainTransaction.create({
          data: { ...base(user.id), status: "FINALIZED", blockNumber: 1n, blockHash: bytes32(), finalizedAt: new Date() },
        });
      }),
    ).rejects.toThrow(/inserted as PENDING/);
  });

  it("cannot jump from PENDING to FINALIZED", async () => {
    await expect(
      inRollback(async (tx) => {
        const user = await mkUser(tx, "ISSUER");
        const row = await tx.blockchainTransaction.create({ data: base(user.id) });
        await tx.blockchainTransaction.update({
          where: { id: row.id },
          data: { status: "FINALIZED", blockNumber: 1n, blockHash: bytes32(), finalizedAt: new Date() },
        });
      }),
    ).rejects.toThrow(/CONFIRMED before/);
  });

  it("rejects a duplicate (chainId, txHash)", async () => {
    await expect(
      inRollback(async (tx) => {
        const user = await mkUser(tx, "ISSUER");
        const data = base(user.id);
        await tx.blockchainTransaction.create({ data });
        await tx.blockchainTransaction.create({ data });
      }),
    ).rejects.toThrow(UNIQUE);
  });
});

describe("history protection", () => {
  it("6. does not allow deleting a Claim", async () => {
    await expect(
      inRollback(async (tx) => {
        const candidate = await mkUser(tx, "CANDIDATE");
        const claim = await tx.claim.create({ data: { candidateId: candidate.id, category: "EXPERIENCE" } });
        await tx.claim.delete({ where: { id: claim.id } });
      }),
    ).rejects.toThrow(/cannot be deleted/);
  });

  it("does not allow deleting or editing a ClaimVersion", async () => {
    await expect(
      inRollback(async (tx) => {
        const candidate = await mkUser(tx, "CANDIDATE");
        const { version } = await mkClaimVersion(tx, candidate.id);
        await tx.claimVersion.delete({ where: { id: version.id } });
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      inRollback(async (tx) => {
        const candidate = await mkUser(tx, "CANDIDATE");
        const { version } = await mkClaimVersion(tx, candidate.id);
        await tx.claimVersion.update({ where: { id: version.id }, data: { content: { title: "Edited in place" } } });
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("does not allow deleting a Credential or an AuditEvent", async () => {
    await expect(
      inRollback(async (tx) => {
        const candidate = await mkUser(tx, "CANDIDATE");
        const org = await mkOrg(tx);
        const { version } = await mkClaimVersion(tx, candidate.id);
        const cred = await mkCredential(tx, org.id, version.id);
        await tx.credential.delete({ where: { id: cred.id } });
      }),
    ).rejects.toThrow(/cannot be deleted/);
    await expect(
      inRollback(async (tx) => {
        const candidate = await mkUser(tx, "CANDIDATE");
        const event = await tx.auditEvent.create({ data: { actorUserId: candidate.id, action: "TEST", targetType: "User" } });
        await tx.auditEvent.delete({ where: { id: event.id } });
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("freezes a credential's lifecycle type after issuance", async () => {
    await expect(
      inRollback(async (tx) => {
        const candidate = await mkUser(tx, "CANDIDATE");
        const org = await mkOrg(tx);
        const { version } = await mkClaimVersion(tx, candidate.id);
        const cred = await mkCredential(tx, org.id, version.id, "PERMANENT");
        await tx.credential.update({ where: { id: cred.id }, data: { lifecycleType: "CONTINUING" } });
      }),
    ).rejects.toThrow(/immutable/);
  });
});

describe("7. no stored verification state in the live database", () => {
  it("has no verified / state / score columns", async () => {
    const rows = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name ~* '(verified|verification_?state|trust|reputation|score)'`;
    expect(rows).toEqual([]);
  });
});
