import { LIFECYCLE_CODE, type LifecycleName } from "@/lib/crypto/constants";
import { dateToUnixSeconds, isBytes32 } from "@/lib/crypto/encoding";
import type { Prisma } from "@/lib/database/generated/client";
import { DomainError } from "@/server/candidate/errors";
import type { IssuerScope } from "@/server/issuer/review";
import { isUuid, type Tx } from "@/server/issuance/common";

// Loads the issued (signed) cryptographic material of a Credential that Merkle leaves are built
// from. Leaves are always rebuilt from Credential rows, never taken from client input.

export const ISSUED_SELECT = {
  id: true,
  organisationId: true,
  lifecycleType: true,
  pipelineStatus: true,
  credentialId: true,
  subjectCommitment: true,
  contentDigest: true,
  validFrom: true,
  validUntil: true,
  issuedAt: true,
  organisation: { select: { orgId: true } },
  claimVersion: { select: { claim: { select: { category: true } } } },
  attestations: { where: { kind: "CREDENTIAL" }, select: { id: true } },
} as const;

type IssuedRow = Prisma.CredentialGetPayload<{ select: typeof ISSUED_SELECT }>;

export type IssuedCredential = {
  id: string;
  organisationId: string;
  orgId: string;
  lifecycleType: LifecycleName;
  lifecycleCode: number;
  category: string;
  pipelineStatus: IssuedRow["pipelineStatus"];
  credentialId: string;
  subjectCommitment: string;
  contentDigest: string;
  /** Effective start of the underlying professional claim (unix seconds). */
  validFrom: bigint;
  /** Expiry (unix seconds) for EXPIRING credentials, otherwise 0n. */
  validUntil: bigint;
  /** Actual cryptographic issuance time (unix seconds). */
  issuedAt: bigint;
  attestationId: string;
};

export function toIssuedCredential(row: IssuedRow): IssuedCredential {
  const { credentialId, subjectCommitment, contentDigest, validFrom, issuedAt } = row;
  const attestation = row.attestations[0];
  if (
    row.pipelineStatus === "AWAITING_SIGNATURE" ||
    !isBytes32(credentialId) ||
    !isBytes32(subjectCommitment) ||
    !isBytes32(contentDigest) ||
    !isBytes32(row.organisation.orgId) ||
    !validFrom ||
    !issuedAt ||
    !attestation
  ) {
    throw new DomainError("CONFLICT", "This credential has not been signed.");
  }
  const lifecycleType = row.lifecycleType as LifecycleName;
  return {
    id: row.id,
    organisationId: row.organisationId,
    orgId: row.organisation.orgId,
    lifecycleType,
    lifecycleCode: LIFECYCLE_CODE[lifecycleType],
    category: row.claimVersion.claim.category,
    pipelineStatus: row.pipelineStatus,
    credentialId,
    subjectCommitment,
    contentDigest,
    validFrom: dateToUnixSeconds(validFrom),
    validUntil: row.validUntil ? dateToUnixSeconds(row.validUntil) : 0n,
    issuedAt: dateToUnixSeconds(issuedAt),
    attestationId: attestation.id,
  };
}

/** A signed credential of the issuer's OWN organisation (another's is NOT_FOUND). */
export async function loadIssuedCredential(tx: Tx, scope: IssuerScope, credentialRowId: string): Promise<IssuedCredential> {
  if (!isUuid(credentialRowId)) throw new DomainError("NOT_FOUND", "Credential not found.");
  const row = await tx.credential.findFirst({
    where: { id: credentialRowId, organisationId: scope.organisationId },
    select: ISSUED_SELECT,
  });
  if (!row) throw new DomainError("NOT_FOUND", "Credential not found.");
  return toIssuedCredential(row);
}

/**
 * Serialises all Merkle writes of one organisation (batch creation, sealing, tree creation).
 * FOR NO KEY UPDATE excludes other writers of the same kind but does not block ordinary inserts
 * that merely reference the organisation (they only take FOR KEY SHARE).
 */
export async function lockOrganisation(tx: Tx, organisationId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId}::uuid FOR NO KEY UPDATE`;
}

/** SIGNED -> QUEUED_FOR_ANCHOR, conditionally; a concurrent change is a CONFLICT. */
export async function markQueued(tx: Tx, credentialRowId: string): Promise<void> {
  const { count } = await tx.credential.updateMany({
    where: { id: credentialRowId, pipelineStatus: "SIGNED" },
    data: { pipelineStatus: "QUEUED_FOR_ANCHOR" },
  });
  if (count !== 1) throw new DomainError("CONFLICT", "This credential could not be queued.");
}
