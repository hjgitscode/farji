import { randomBytes, randomUUID } from "node:crypto";
import { createDbClient } from "@/lib/database/client";
import type { Prisma } from "@/lib/database/generated/client";

export type Tx = Prisma.TransactionClient;
export type Lifecycle = "PERMANENT" | "CONTINUING" | "EXPIRING";

export const db = createDbClient((process.env.DIRECT_URL ?? process.env.DATABASE_URL)!);

class Rollback extends Error {}

/** Runs fn in a transaction that is ALWAYS rolled back. Errors from fn propagate. */
export async function inRollback<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let result!: T;
  try {
    await db.$transaction(
      async (tx) => {
        result = await fn(tx);
        throw new Rollback();
      },
      { timeout: 25000 },
    );
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return result;
}

export const bytes32 = () => "0x" + randomBytes(32).toString("hex");
export const address = () => "0x" + randomBytes(20).toString("hex");
export const ZERO_HASH = "0x" + "0".repeat(64);
const slug = () => "t" + randomBytes(6).toString("hex");

export const mkUser = (tx: Tx, role: "CANDIDATE" | "ISSUER" | "ADMIN") =>
  tx.user.create({ data: { authUserId: randomUUID(), role } });

export const mkOrg = (tx: Tx, status?: "PENDING_ONBOARDING" | "ACTIVE" | "SUSPENDED") =>
  tx.organisation.create({
    data: { orgId: bytes32(), slug: slug(), legalName: "Test Org Ltd", displayName: "Test Org", kind: "EMPLOYER", ...(status ? { status } : {}) },
  });

export const mkIssuerKey = (tx: Tx, organisationId: string, walletAddress = address()) =>
  tx.issuerKey.create({ data: { organisationId, walletAddress, validFrom: new Date("2026-01-01T00:00:00Z") } });

export async function mkClaimVersion(tx: Tx, candidateId: string, lifecycle: Lifecycle = "PERMANENT") {
  const claim = await tx.claim.create({ data: { candidateId, category: "EXPERIENCE" } });
  const version = await tx.claimVersion.create({
    data: { claimId: claim.id, versionNumber: 1, content: { title: "Test" }, proposedLifecycleType: lifecycle },
  });
  return { claim, version };
}

export const mkCredential = (tx: Tx, organisationId: string, claimVersionId: string, lifecycleType: Lifecycle = "PERMANENT") =>
  tx.credential.create({ data: { organisationId, claimVersionId, lifecycleType } });

/** A transaction row that the chain sync has observed (PENDING -> CONFIRMED). */
export async function mkConfirmedTx(
  tx: Tx,
  purpose: "ANCHOR_COHORT" | "ANCHOR_PROOF_PULSE" | "REVOKE_CREDENTIAL",
  initiatedByUserId: string,
  organisationId: string,
) {
  const row = await tx.blockchainTransaction.create({
    data: {
      chainId: 31337,
      txHash: bytes32(),
      purpose,
      targetType: purpose === "REVOKE_CREDENTIAL" ? "CREDENTIAL" : "ORGANISATION",
      targetId: organisationId,
      fromAddress: address(),
      initiatedByUserId,
      organisationId,
    },
  });
  return tx.blockchainTransaction.update({
    where: { id: row.id },
    data: { status: "CONFIRMED", blockNumber: 1n, blockHash: bytes32(), confirmedAt: new Date() },
  });
}
