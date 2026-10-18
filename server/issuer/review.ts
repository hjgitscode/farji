import type { Actor } from "@/lib/auth/authorize";
import { credentialTermsFrom, validateReviewInput } from "@/lib/core/review";
import type { Prisma, PrismaClient } from "@/lib/database/generated/client";
import { DomainError } from "@/server/candidate/errors";

// Issuer review + credential issuance workflow (Phase 5), up to the signing boundary.
//
// Rules enforced here (and, for the invariants that matter, again by the database):
// - Every function requires an ISSUER actor resolved server-side by the Phase 3 guard, with an
//   ACTIVE OrganisationMember of an ACTIVE Organisation, checked before any database access.
//   Mutations re-check that membership inside the transaction.
// - The Organisation scope is ALWAYS actor.organisationId. No organisation, member or key id is
//   ever read from client input. A request of another Organisation is indistinguishable from a
//   missing one (NOT_FOUND).
// - A reviewer can never decide their own claim (also enforced by a database trigger).
// - Approve and reject use a CONDITIONAL status update (open -> terminal) as the first write, so
//   the row lock serialises concurrent decisions: exactly one wins, the other gets CONFLICT.
//   ReviewDecision is unique per request and Credential is unique per ClaimVersion, so a second
//   decision or credential is impossible even if the service check were bypassed.
// - APPROVE creates the ReviewDecision and ONE Credential (AWAITING_SIGNATURE) with no
//   cryptographic material. Nothing here signs, hashes, anchors, or creates an Attestation,
//   Anchor, BlockchainTransaction, CohortLeaf or ProofPulse row, and no verification state is
//   stored or returned. Request statuses are operational workflow statuses only.
// - REJECT never deletes anything: it is a status transition plus an append-only ReviewDecision.
// - Every mutation writes an AuditEvent in the same transaction.

export type ReviewDb = Pick<
  PrismaClient,
  "verificationRequest" | "reviewDecision" | "credential" | "organisationMember" | "auditEvent"
> &
  Partial<Pick<PrismaClient, "$transaction">>;

type Tx = Prisma.TransactionClient;

const OPEN_STATUSES = ["SUBMITTED", "IN_REVIEW"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
const dbMessage = (e: unknown) => (e instanceof Error ? e.message : "");

/** The verified issuer identity, narrowed so organisation and member are non-null. */
type IssuerScope = { userId: string; organisationId: string; memberId: string };

function assertIssuer(actor: Actor): IssuerScope {
  if (
    !actor ||
    actor.role !== "ISSUER" ||
    !isUuid(actor.userId) ||
    !isUuid(actor.organisationId) ||
    !isUuid(actor.memberId) ||
    actor.organisationStatus !== "ACTIVE"
  ) {
    throw new DomainError("FORBIDDEN", "Only an active issuer of an active organisation can do this.");
  }
  return { userId: actor.userId, organisationId: actor.organisationId, memberId: actor.memberId };
}

async function inTransaction<T>(db: ReviewDb, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction ? db.$transaction(fn) : fn(db as unknown as Tx);
}

/** The actor's membership may have changed since the guard ran: confirm it inside the transaction. */
async function assertStillActiveMember(tx: Tx, scope: IssuerScope): Promise<void> {
  const member = await tx.organisationMember.findFirst({
    where: {
      id: scope.memberId,
      userId: scope.userId,
      organisationId: scope.organisationId,
      status: "ACTIVE",
      organisation: { status: "ACTIVE" },
    },
    select: { id: true },
  });
  if (!member) throw new DomainError("FORBIDDEN", "Only an active issuer of an active organisation can do this.");
}

function audit(tx: Tx, scope: IssuerScope, action: string, targetId: string, metadata: Prisma.InputJsonObject) {
  return tx.auditEvent.create({
    data: {
      actorUserId: scope.userId,
      actorRole: "ISSUER",
      organisationId: scope.organisationId,
      action,
      targetType: "VerificationRequest",
      targetId,
      metadata,
    },
  });
}

// ───────────────────────────── read ─────────────────────────────

const LIST_SELECT = {
  id: true,
  status: true,
  submittedAt: true,
  closedAt: true,
  institutionalIdentifier: true,
  claimVersion: {
    select: {
      id: true,
      versionNumber: true,
      content: true,
      proposedLifecycleType: true,
      claim: { select: { id: true, category: true } },
    },
  },
  decision: { select: { decision: true, rejectionReason: true, decidedAt: true } },
} as const;

/** Requests addressed to the issuer's own organisation. Default: open (SUBMITTED / IN_REVIEW) only. */
export async function listIssuerRequests(db: ReviewDb, actor: Actor, filter: "open" | "all" = "open") {
  const scope = assertIssuer(actor);
  return db.verificationRequest.findMany({
    where: { organisationId: scope.organisationId, ...(filter === "open" ? { status: { in: [...OPEN_STATUSES] } } : {}) },
    orderBy: { submittedAt: "asc" },
    take: 200,
    select: LIST_SELECT,
  });
}

export async function getIssuerRequest(db: ReviewDb, actor: Actor, requestId: string) {
  const scope = assertIssuer(actor);
  if (!isUuid(requestId)) throw new DomainError("NOT_FOUND", "Request not found.");

  const request = await db.verificationRequest.findFirst({
    where: { id: requestId, organisationId: scope.organisationId },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      closedAt: true,
      institutionalIdentifier: true,
      candidateNote: true,
      candidateId: true,
      claimVersion: {
        select: {
          id: true,
          versionNumber: true,
          content: true,
          proposedLifecycleType: true,
          claim: {
            select: {
              id: true,
              category: true,
              versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true } },
            },
          },
          credential: { select: { id: true, pipelineStatus: true, lifecycleType: true, validUntil: true } },
        },
      },
      // The issuing organisation may read its own internal notes and source-of-truth reference.
      decision: { select: { decision: true, rejectionReason: true, notes: true, sourceOfTruthReference: true, decidedAt: true } },
    },
  });
  if (!request) throw new DomainError("NOT_FOUND", "Request not found.");

  const { candidateId, claimVersion, ...rest } = request;
  const { claim, ...version } = claimVersion;
  return {
    ...rest,
    claimVersion: { ...version, claimId: claim.id, category: claim.category, isCurrentVersion: claim.versions[0]?.id === version.id },
    isOwnClaim: candidateId === scope.userId,
  };
}

// ───────────────────────────── decide ─────────────────────────────

/** Common first steps of approve/reject: validate input, load the scoped request, run the guards. */
async function loadReviewable(tx: Tx, scope: IssuerScope, requestId: string) {
  await assertStillActiveMember(tx, scope);

  // Scoped by the issuer's own organisation: another organisation's request is NOT_FOUND.
  const request = await tx.verificationRequest.findFirst({
    where: { id: requestId, organisationId: scope.organisationId },
    select: {
      id: true,
      status: true,
      candidateId: true,
      claimVersion: {
        select: {
          id: true,
          proposedLifecycleType: true,
          content: true,
          claim: { select: { id: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true } } } },
        },
      },
    },
  });
  if (!request) throw new DomainError("NOT_FOUND", "Request not found.");
  if (request.candidateId === scope.userId) throw new DomainError("FORBIDDEN", "You cannot review your own claim.");
  if (!(OPEN_STATUSES as readonly string[]).includes(request.status)) {
    throw new DomainError("CONFLICT", "This request is no longer open for review.");
  }
  return request;
}

/** Open -> terminal. The conditional update is the concurrency gate: only one decision can win. */
async function closeRequest(tx: Tx, scope: IssuerScope, requestId: string, to: "APPROVED" | "REJECTED", at: Date): Promise<void> {
  const { count } = await tx.verificationRequest.updateMany({
    where: { id: requestId, organisationId: scope.organisationId, status: { in: [...OPEN_STATUSES] } },
    data: { status: to, closedAt: at },
  });
  if (count !== 1) throw new DomainError("CONFLICT", "This request is no longer open for review.");
}

function translateDbError(e: unknown): never {
  if (e instanceof DomainError) throw e;
  if (isUniqueViolation(e)) throw new DomainError("CONFLICT", "This request or record has already been decided.");
  const m = dbMessage(e);
  if (m.includes("cannot review their own claim")) throw new DomainError("FORBIDDEN", "You cannot review your own claim.");
  if (m.includes("reviewer must be an ACTIVE")) throw new DomainError("FORBIDDEN", "Only an active issuer of an active organisation can do this.");
  throw e;
}

export type ApproveResult = { requestId: string; decisionId: string; credentialRowId: string; pipelineStatus: "AWAITING_SIGNATURE" };

export async function approveVerificationRequest(
  db: ReviewDb,
  actor: Actor,
  requestId: string,
  rawInput: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<ApproveResult> {
  const scope = assertIssuer(actor);
  if (!isUuid(requestId)) throw new DomainError("NOT_FOUND", "Request not found.");
  const input = validateReviewInput("APPROVE", rawInput);
  if (!input.ok) throw new DomainError("VALIDATION", "Please correct the highlighted fields.", input.errors);

  try {
    return await inTransaction(db, async (tx) => {
      const request = await loadReviewable(tx, scope, requestId);
      const version = request.claimVersion;

      // Only the CURRENT version of a claim can be issued (an older one is superseded).
      if (version.claim.versions[0]?.id !== version.id) {
        throw new DomainError("CONFLICT", "This request is for a version that has been replaced by a newer one.");
      }
      const terms = credentialTermsFrom(version.proposedLifecycleType, version.content);
      if (!terms) throw new DomainError("CONFLICT", "This record cannot be issued as submitted (missing or invalid expiry date).");

      // One Credential per ClaimVersion (also a unique constraint).
      const existing = await tx.credential.findFirst({ where: { claimVersionId: version.id }, select: { id: true } });
      if (existing) throw new DomainError("CONFLICT", "A credential already exists for this version.");

      await closeRequest(tx, scope, request.id, "APPROVED", now);

      const decision = await tx.reviewDecision.create({
        data: {
          verificationRequestId: request.id,
          organisationId: scope.organisationId,
          reviewerMemberId: scope.memberId,
          decision: "APPROVE",
          notes: input.value.notes,
          sourceOfTruthReference: input.value.sourceOfTruthReference,
          decidedAt: now,
        },
        select: { id: true },
      });

      // Pre-signing Credential: lifecycle type fixed, no salts/ids/digests (Phase 6 creates
      // them at signing), no Attestation, Anchor, transaction or Merkle leaf.
      const credential = await tx.credential.create({
        data: {
          organisationId: scope.organisationId,
          claimVersionId: version.id,
          reviewDecisionId: decision.id,
          lifecycleType: terms.lifecycleType,
          validUntil: terms.validUntil,
          pipelineStatus: "AWAITING_SIGNATURE",
        },
        select: { id: true },
      });

      await audit(tx, scope, "REQUEST_APPROVED", request.id, {
        decisionId: decision.id,
        credentialRowId: credential.id,
        claimVersionId: version.id,
        lifecycleType: terms.lifecycleType,
      });
      return { requestId: request.id, decisionId: decision.id, credentialRowId: credential.id, pipelineStatus: "AWAITING_SIGNATURE" as const };
    });
  } catch (e) {
    return translateDbError(e);
  }
}

export type RejectResult = { requestId: string; decisionId: string };

export async function rejectVerificationRequest(
  db: ReviewDb,
  actor: Actor,
  requestId: string,
  rawInput: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<RejectResult> {
  const scope = assertIssuer(actor);
  if (!isUuid(requestId)) throw new DomainError("NOT_FOUND", "Request not found.");
  const input = validateReviewInput("REJECT", rawInput);
  if (!input.ok) throw new DomainError("VALIDATION", "Please correct the highlighted fields.", input.errors);
  const reason = input.value.rejectionReason;
  if (!reason) throw new DomainError("VALIDATION", "Choose a rejection reason.", { rejectionReason: "Choose a rejection reason." });

  try {
    return await inTransaction(db, async (tx) => {
      const request = await loadReviewable(tx, scope, requestId);

      await closeRequest(tx, scope, request.id, "REJECTED", now);

      // Append-only. The claim, version and request are all retained; no Credential is created.
      const decision = await tx.reviewDecision.create({
        data: {
          verificationRequestId: request.id,
          organisationId: scope.organisationId,
          reviewerMemberId: scope.memberId,
          decision: "REJECT",
          rejectionReason: reason,
          notes: input.value.notes,
          sourceOfTruthReference: input.value.sourceOfTruthReference,
          decidedAt: now,
        },
        select: { id: true },
      });

      await audit(tx, scope, "REQUEST_REJECTED", request.id, { decisionId: decision.id, rejectionReason: reason });
      return { requestId: request.id, decisionId: decision.id };
    });
  } catch (e) {
    return translateDbError(e);
  }
}
