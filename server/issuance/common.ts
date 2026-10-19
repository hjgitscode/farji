import { canonicalCredentialContent, type CanonicalContent } from "@/lib/crypto/canonical";
import { contentDigestOf, credentialIdOf, subjectCommitmentOf } from "@/lib/crypto/commitments";
import { ZERO_HASH, type CategoryName, type LifecycleName } from "@/lib/crypto/constants";
import { dateToUnixSeconds, isBytes32, isoDateToUnixSeconds, uuidToBytes16 } from "@/lib/crypto/encoding";
import { checkKeyForNewAttestation, type KeyDenial } from "@/lib/crypto/keys";
import type { Prisma, PrismaClient } from "@/lib/database/generated/client";
import { DomainError } from "@/server/candidate/errors";
import type { IssuerScope } from "@/server/issuer/review";

// Shared plumbing for the Phase 6/7 issuance services. Server-only: it reads the database.

export type IssuanceDb = Pick<
  PrismaClient,
  | "credential"
  | "attestation"
  | "issuerKey"
  | "auditEvent"
  | "organisationMember"
  | "cohortBatch"
  | "cohortLeaf"
  | "proofPulseTree"
  | "proofPulseLeaf"
  | "proofPulseNode"
  | "proofPulseUpdate"
  | "$queryRaw"
  | "$executeRaw"
> &
  Partial<Pick<PrismaClient, "$transaction">>;

export type Tx = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

export async function inTransaction<T>(db: IssuanceDb, fn: (tx: Tx) => Promise<T>): Promise<T> {
  // Interactive transactions can be slow over a pooled Supabase connection.
  return db.$transaction ? db.$transaction(fn, { timeout: 20000, maxWait: 10000 }) : fn(db as unknown as Tx);
}

export function audit(tx: Tx, scope: IssuerScope, action: string, targetType: string, targetId: string, metadata: Prisma.InputJsonObject) {
  // IDs and sequence numbers only. Never salts, signatures or claim content.
  return tx.auditEvent.create({
    data: { actorUserId: scope.userId, actorRole: "ISSUER", organisationId: scope.organisationId, action, targetType, targetId, metadata },
  });
}

/** Options shared by the services: clock and randomness are injectable for deterministic tests. */
export type ServiceOptions = { now?: Date; random?: () => string };

// ───────────────────────────── credential context ─────────────────────────────

const CONTEXT_SELECT = {
  id: true,
  organisationId: true,
  claimVersionId: true,
  lifecycleType: true,
  pipelineStatus: true,
  validFrom: true,
  validUntil: true,
  credentialId: true,
  credentialSalt: true,
  contentSalt: true,
  subjectSalt: true,
  subjectCommitment: true,
  contentDigest: true,
  issuedAt: true,
  supersedesCredentialId: true,
  organisation: { select: { orgId: true } },
  claimVersion: {
    select: {
      id: true,
      versionNumber: true,
      content: true,
      claim: {
        select: {
          id: true,
          category: true,
          candidateId: true,
          versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true } },
        },
      },
    },
  },
  attestations: { where: { kind: "CREDENTIAL" }, select: { id: true, typedDataHash: true } },
} as const;

export type CredentialContext = Prisma.CredentialGetPayload<{ select: typeof CONTEXT_SELECT }>;

/** Loads a credential of the ISSUER'S OWN organisation; another organisation's is NOT_FOUND. */
export async function loadCredentialContext(tx: Tx, scope: IssuerScope, credentialRowId: string): Promise<CredentialContext> {
  if (!isUuid(credentialRowId)) throw new DomainError("NOT_FOUND", "Credential not found.");
  const credential = await tx.credential.findFirst({
    where: { id: credentialRowId, organisationId: scope.organisationId },
    select: CONTEXT_SELECT,
  });
  if (!credential) throw new DomainError("NOT_FOUND", "Credential not found.");
  return credential;
}

/** Refuses self-issuance and non-current versions (ROADMAP D44). */
export function assertSignable(ctx: CredentialContext, scope: IssuerScope): void {
  if (ctx.claimVersion.claim.candidateId === scope.userId) {
    throw new DomainError("FORBIDDEN", "You cannot issue a credential for your own claim.");
  }
  if (ctx.claimVersion.claim.versions[0]?.id !== ctx.claimVersion.id) {
    throw new DomainError("CONFLICT", "This credential is for a version that has been replaced by a newer one.");
  }
}

export type CanonicalTerms = {
  content: CanonicalContent;
  /** Effective start of the underlying professional claim (unix seconds). NOT the signing time. */
  validFrom: bigint;
  validUntil: bigint;
};

/** Canonical content and the dates derived from it, checked against what the Credential stores. */
export function canonicalTerms(ctx: CredentialContext): CanonicalTerms {
  const canonical = canonicalCredentialContent(
    ctx.claimVersion.claim.category as CategoryName,
    ctx.lifecycleType as LifecycleName,
    ctx.claimVersion.content,
  );
  if (!canonical.ok) {
    throw new DomainError("CONFLICT", "This credential's content cannot be issued as stored.", canonical.errors);
  }
  const content = canonical.value;
  const validFrom = isoDateToUnixSeconds(content.startDate);

  let validUntil = 0n;
  if (ctx.lifecycleType === "EXPIRING") {
    validUntil = isoDateToUnixSeconds(content.expiryDate);
    if (!ctx.validUntil || dateToUnixSeconds(ctx.validUntil) !== validUntil) {
      throw new DomainError("CONFLICT", "The credential expiry does not match its content.");
    }
    if (validUntil <= validFrom) throw new DomainError("CONFLICT", "The expiry must be after the start date.");
  } else if (ctx.validUntil) {
    throw new DomainError("CONFLICT", "Only an EXPIRING credential has an expiry.");
  }
  return { content, validFrom, validUntil };
}

export type Material = {
  orgId: string;
  credentialId: string;
  subjectCommitment: string;
  contentDigest: string;
  contentSalt: string;
};

export type Salts = { credentialSalt: string; contentSalt: string; subjectSalt: string };

/** Derives every identifier from salts + canonical content. Pure given its inputs. */
export function deriveMaterial(ctx: CredentialContext, terms: CanonicalTerms, salts: Salts): Material {
  const orgId = ctx.organisation.orgId;
  if (!isBytes32(orgId)) throw new DomainError("CONFLICT", "The organisation identifier is malformed.");
  return {
    orgId,
    credentialId: credentialIdOf(orgId, salts.credentialSalt),
    subjectCommitment: subjectCommitmentOf(uuidToBytes16(ctx.claimVersion.claim.candidateId), salts.subjectSalt),
    contentDigest: contentDigestOf(terms.content, salts.contentSalt),
    contentSalt: salts.contentSalt,
  };
}

/** The stored salts; throws CONFLICT if the credential was never prepared (or only partly). */
export function storedSalts(ctx: CredentialContext): Salts {
  const { credentialSalt, contentSalt, subjectSalt } = ctx;
  if (!credentialSalt || !contentSalt || !subjectSalt) {
    throw new DomainError("CONFLICT", "This credential has not been prepared for signing.");
  }
  return { credentialSalt, contentSalt, subjectSalt };
}

/** Recomputes the identifiers from the stored salts and requires them to equal the stored columns. */
export function verifiedMaterial(ctx: CredentialContext, terms: CanonicalTerms): Material {
  const material = deriveMaterial(ctx, terms, storedSalts(ctx));
  if (
    ctx.credentialId !== material.credentialId ||
    ctx.subjectCommitment !== material.subjectCommitment ||
    ctx.contentDigest !== material.contentDigest ||
    !ctx.validFrom ||
    dateToUnixSeconds(ctx.validFrom) !== terms.validFrom
  ) {
    // The stored claim content, salts and derived columns no longer agree: never sign this.
    throw new DomainError("CONFLICT", "The stored credential material does not match its content.");
  }
  return material;
}

/**
 * The credential this one supersedes (the latest earlier SIGNED-or-later credential of the same
 * claim and organisation), as the bytes32 credentialId for the message and the row id for the FK.
 * Once signed, the stored link is authoritative.
 */
export async function resolveSupersedes(tx: Tx, ctx: CredentialContext): Promise<{ rowId: string | null; credentialId: string }> {
  if (ctx.pipelineStatus !== "AWAITING_SIGNATURE") {
    if (!ctx.supersedesCredentialId) return { rowId: null, credentialId: ZERO_HASH };
    const prev = await tx.credential.findUnique({ where: { id: ctx.supersedesCredentialId }, select: { credentialId: true } });
    return { rowId: ctx.supersedesCredentialId, credentialId: prev?.credentialId ?? ZERO_HASH };
  }
  const prev = await tx.credential.findFirst({
    where: {
      organisationId: ctx.organisationId,
      claimVersion: { claimId: ctx.claimVersion.claim.id, versionNumber: { lt: ctx.claimVersion.versionNumber } },
      pipelineStatus: { not: "AWAITING_SIGNATURE" },
    },
    orderBy: { claimVersion: { versionNumber: "desc" } },
    select: { id: true, credentialId: true },
  });
  if (!prev || !prev.credentialId) return { rowId: null, credentialId: ZERO_HASH };
  return { rowId: prev.id, credentialId: prev.credentialId };
}

// ───────────────────────────── signing key ─────────────────────────────

const DENIAL_MESSAGE: Record<KeyDenial, string> = {
  COMPROMISED: "The signing wallet has been marked compromised.",
  NOT_AUTHORISED_AT_ISSUANCE: "The signing wallet was not authorised at the signed issuance time.",
  NOT_CURRENTLY_AUTHORISED: "The signing wallet is no longer authorised to issue.",
};

/**
 * Finds the IssuerKey for a recovered signer address AMONG THE CREDENTIAL'S OWN ORGANISATION and
 * checks its history. Returns the key id. A wallet of another organisation is indistinguishable
 * from an unknown one.
 */
export async function requireSigningKey(
  tx: Tx,
  organisationId: string,
  signer: string,
  issuedAt: Date,
  now: Date,
  memberId: string,
): Promise<string> {
  const key = await tx.issuerKey.findFirst({
    where: { walletAddress: signer, organisationId },
    select: { id: true, validFrom: true, validUntil: true, compromisedAt: true, operatorMemberId: true },
  });
  if (!key) throw new DomainError("FORBIDDEN", "The signing wallet is not an authorised issuer wallet of this organisation.");
  const denial = checkKeyForNewAttestation(key, issuedAt, now);
  if (denial) throw new DomainError("FORBIDDEN", DENIAL_MESSAGE[denial]);
  if (key.operatorMemberId && key.operatorMemberId !== memberId) {
    throw new DomainError("FORBIDDEN", "This wallet is operated by a different member of the organisation.");
  }
  return key.id;
}

// ───────────────────────────── signature input ─────────────────────────────

export const ISSUED_AT_MAX_AGE_SECONDS = 600n;
export const ISSUED_AT_MAX_FUTURE_SECONDS = 120n;

export type SignatureInput = { signature: unknown; issuedAt: unknown; nonce: unknown };
export type ParsedSignatureInput = { signature: string; issuedAt: bigint; nonce: string };

export function parseUnixSeconds(value: unknown, field: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^[0-9]{1,15}$/.test(value)) return BigInt(value);
  throw new DomainError("VALIDATION", `${field} must be unix seconds.`, { [field]: `${field} must be unix seconds.` });
}

export const parseIssuedAt = (value: unknown): bigint => parseUnixSeconds(value, "issuedAt");

export function parseNonce(value: unknown): string {
  if (!isBytes32(value)) throw new DomainError("VALIDATION", "Invalid nonce.", { nonce: "Invalid nonce." });
  return value;
}

/** The signed issuance time must be recent: it bounds backdating and stale-signature acceptance. */
export function assertIssuedAtWindow(issuedAt: bigint, nowSec: bigint): void {
  if (issuedAt < nowSec - ISSUED_AT_MAX_AGE_SECONDS || issuedAt > nowSec + ISSUED_AT_MAX_FUTURE_SECONDS) {
    throw new DomainError("VALIDATION", "The signature is too old or from the future. Prepare and sign again.", {
      issuedAt: "Outside the accepted signing window.",
    });
  }
}
