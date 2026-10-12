import type { Actor } from "@/lib/auth/authorize";
import { sameDraft, validateClaimDraft } from "@/lib/core/claims";
import type { Prisma, PrismaClient } from "@/lib/database/generated/client";
import { DomainError } from "./errors";

// Candidate claim + verification-request services (Phase 4).
//
// Rules enforced here (and, for the invariants that matter, again by the database):
// - Every function requires a CANDIDATE actor resolved server-side by the Phase 3 guards.
//   The candidate id is ALWAYS actor.userId; no id is ever read from client input.
// - Claims/requests of other candidates are indistinguishable from missing ones (NOT_FOUND).
// - ClaimVersions are immutable: an edit inserts version N+1.
// - Nothing here creates a Credential, ReviewDecision or Attestation, and nothing stores or
//   returns a verification state. Request statuses are operational workflow statuses only.
// - Every mutation writes an AuditEvent in the same transaction.

/** A PrismaClient or an interactive-transaction client (which has no $transaction). */
export type ClaimsDb = Pick<
  PrismaClient,
  "claim" | "claimVersion" | "verificationRequest" | "organisation" | "credential" | "auditEvent"
> &
  Partial<Pick<PrismaClient, "$transaction">>;

type Tx = Prisma.TransactionClient;

const OPEN_STATUSES = ["SUBMITTED", "IN_REVIEW"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

function assertCandidate(actor: Actor): void {
  if (!actor || actor.role !== "CANDIDATE" || !isUuid(actor.userId)) {
    throw new DomainError("FORBIDDEN", "Only a candidate can do this.");
  }
}

async function inTransaction<T>(db: ClaimsDb, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction ? db.$transaction(fn) : fn(db as unknown as Tx);
}

function audit(tx: Tx, actor: Actor, action: string, targetType: string, targetId: string, metadata: Prisma.InputJsonObject) {
  return tx.auditEvent.create({
    data: { actorUserId: actor.userId, actorRole: "CANDIDATE", action, targetType, targetId, metadata },
  });
}

function toJson(content: unknown): Prisma.InputJsonObject {
  return content as Prisma.InputJsonObject;
}

// ───────────────────────────── create ─────────────────────────────

export async function createClaim(
  db: ClaimsDb,
  actor: Actor,
  rawInput: Record<string, unknown>,
  now: Date = new Date(),
): Promise<{ claimId: string; claimVersionId: string }> {
  assertCandidate(actor);
  const result = validateClaimDraft(rawInput, now);
  if (!result.ok) throw new DomainError("VALIDATION", "Please correct the highlighted fields.", result.errors);
  const { category, lifecycleType, content } = result.value;

  return inTransaction(db, async (tx) => {
    const claim = await tx.claim.create({ data: { candidateId: actor.userId, category }, select: { id: true } });
    const version = await tx.claimVersion.create({
      data: {
        claimId: claim.id,
        versionNumber: 1,
        content: toJson(content),
        proposedLifecycleType: lifecycleType,
        authoredBy: "CANDIDATE",
      },
      select: { id: true },
    });
    await audit(tx, actor, "CLAIM_CREATED", "Claim", claim.id, { claimVersionId: version.id, versionNumber: 1, category });
    return { claimId: claim.id, claimVersionId: version.id };
  });
}

// ───────────────────────────── read ─────────────────────────────

const REQUEST_SELECT = {
  id: true,
  claimVersionId: true,
  status: true,
  submittedAt: true,
  closedAt: true,
  institutionalIdentifier: true,
  candidateNote: true,
  organisation: { select: { id: true, displayName: true } },
  // The candidate may see their own rejection reason. Internal notes and the
  // source-of-truth reference are deliberately NOT selected.
  decision: { select: { decision: true, rejectionReason: true, decidedAt: true } },
} as const;

export async function listCandidateClaims(db: ClaimsDb, actor: Actor) {
  assertCandidate(actor);
  const claims = await db.claim.findMany({
    where: { candidateId: actor.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      category: true,
      archivedAt: true,
      createdAt: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: {
          id: true,
          versionNumber: true,
          content: true,
          proposedLifecycleType: true,
          createdAt: true,
          verificationRequests: { orderBy: { submittedAt: "desc" }, select: REQUEST_SELECT },
        },
      },
    },
  });
  return claims.map(({ versions, ...claim }) => ({ ...claim, latestVersion: versions[0] ?? null }));
}

export async function getCandidateClaim(db: ClaimsDb, actor: Actor, claimId: string) {
  assertCandidate(actor);
  if (!isUuid(claimId)) throw new DomainError("NOT_FOUND", "Claim not found.");

  const claim = await db.claim.findFirst({
    where: { id: claimId, candidateId: actor.userId },
    select: {
      id: true,
      category: true,
      organisationId: true,
      archivedAt: true,
      createdAt: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        select: {
          id: true,
          versionNumber: true,
          content: true,
          proposedLifecycleType: true,
          createdAt: true,
          verificationRequests: { orderBy: { submittedAt: "desc" }, select: REQUEST_SELECT },
        },
      },
    },
  });
  if (!claim) throw new DomainError("NOT_FOUND", "Claim not found.");
  const { versions, ...rest } = claim;
  return { ...rest, latestVersion: versions[0] ?? null, versions };
}

/** Organisations a candidate may send a request to (ACTIVE only). */
export async function listRequestableOrganisations(db: ClaimsDb, actor: Actor) {
  assertCandidate(actor);
  return db.organisation.findMany({
    where: { status: "ACTIVE" },
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, kind: true },
  });
}

// ───────────────────────────── edit ─────────────────────────────

export async function updateClaim(
  db: ClaimsDb,
  actor: Actor,
  claimId: string,
  rawInput: Record<string, unknown>,
  now: Date = new Date(),
): Promise<{ changed: boolean; claimVersionId: string; versionNumber: number; supersededRequests: number }> {
  assertCandidate(actor);
  if (!isUuid(claimId)) throw new DomainError("NOT_FOUND", "Claim not found.");

  return inTransaction(db, async (tx) => {
    const claim = await tx.claim.findFirst({
      where: { id: claimId, candidateId: actor.userId },
      select: {
        id: true,
        category: true,
        archivedAt: true,
        versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true, versionNumber: true, content: true, proposedLifecycleType: true } },
      },
    });
    if (!claim) throw new DomainError("NOT_FOUND", "Claim not found.");
    if (claim.archivedAt) throw new DomainError("CONFLICT", "This claim is archived and cannot be edited.");
    const latest = claim.versions[0];
    if (!latest) throw new DomainError("CONFLICT", "This claim has no versions.");

    // The category of a claim never changes; it is taken from the stored claim, not the form.
    const result = validateClaimDraft(rawInput, now, claim.category);
    if (!result.ok) throw new DomainError("VALIDATION", "Please correct the highlighted fields.", result.errors);
    const { lifecycleType, content } = result.value;

    if (sameDraft({ lifecycleType, content }, { lifecycleType: latest.proposedLifecycleType, content: latest.content })) {
      return { changed: false, claimVersionId: latest.id, versionNumber: latest.versionNumber, supersededRequests: 0 };
    }

    const versionNumber = latest.versionNumber + 1;
    let version: { id: string };
    try {
      version = await tx.claimVersion.create({
        data: {
          claimId: claim.id,
          versionNumber,
          content: toJson(content),
          proposedLifecycleType: lifecycleType,
          authoredBy: "CANDIDATE",
        },
        select: { id: true },
      });
    } catch (e) {
      // (claimId, versionNumber) is unique: a concurrent edit took this number.
      if (isUniqueViolation(e)) throw new DomainError("CONFLICT", "This claim was just edited elsewhere. Reload and try again.");
      throw e;
    }

    // DOMAIN_MODEL §7.1: editing while a request is open moves that request to SUPERSEDED.
    const open = await tx.verificationRequest.findMany({
      where: { candidateId: actor.userId, claimVersion: { claimId: claim.id }, status: { in: [...OPEN_STATUSES] } },
      select: { id: true },
    });
    let superseded = 0;
    for (const request of open) {
      const { count } = await tx.verificationRequest.updateMany({
        where: { id: request.id, candidateId: actor.userId, status: { in: [...OPEN_STATUSES] } },
        data: { status: "SUPERSEDED", closedAt: new Date() },
      });
      if (count === 1) {
        superseded += 1;
        await audit(tx, actor, "REQUEST_SUPERSEDED", "VerificationRequest", request.id, { byClaimVersionId: version.id });
      }
    }

    await audit(tx, actor, "CLAIM_VERSION_CREATED", "Claim", claim.id, {
      claimVersionId: version.id,
      versionNumber,
      previousVersionNumber: latest.versionNumber,
    });
    return { changed: true, claimVersionId: version.id, versionNumber, supersededRequests: superseded };
  });
}

// ───────────────────────────── verification requests ─────────────────────────────

export type SubmitRequestInput = {
  claimId: string;
  claimVersionId: string;
  organisationId: string;
  institutionalIdentifier?: string;
  candidateNote?: string;
};

export async function submitVerificationRequest(db: ClaimsDb, actor: Actor, input: SubmitRequestInput) {
  assertCandidate(actor);
  if (!isUuid(input.claimId) || !isUuid(input.claimVersionId)) throw new DomainError("NOT_FOUND", "Claim not found.");
  if (!isUuid(input.organisationId)) throw new DomainError("VALIDATION", "Choose an organisation.", { organisationId: "Choose an organisation." });

  const identifier = (input.institutionalIdentifier ?? "").trim();
  const note = (input.candidateNote ?? "").trim();
  const fieldErrors: Record<string, string> = {};
  if (identifier.length > 100) fieldErrors.institutionalIdentifier = "Must be at most 100 characters.";
  if (note.length > 1000) fieldErrors.candidateNote = "Must be at most 1000 characters.";
  if (Object.keys(fieldErrors).length) throw new DomainError("VALIDATION", "Please correct the highlighted fields.", fieldErrors);

  return inTransaction(db, async (tx) => {
    // Ownership: the claim must belong to THIS candidate, and the version to that claim.
    const claim = await tx.claim.findFirst({
      where: { id: input.claimId, candidateId: actor.userId },
      select: {
        id: true,
        organisationId: true,
        archivedAt: true,
        versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true } },
      },
    });
    if (!claim) throw new DomainError("NOT_FOUND", "Claim not found.");
    if (claim.archivedAt) throw new DomainError("CONFLICT", "This claim is archived.");

    const version = await tx.claimVersion.findFirst({ where: { id: input.claimVersionId, claimId: claim.id }, select: { id: true } });
    if (!version) throw new DomainError("NOT_FOUND", "Claim version not found.");
    if (claim.versions[0]?.id !== version.id) {
      throw new DomainError("CONFLICT", "That version has been replaced by a newer one. Request verification of the latest version.");
    }

    // The organisation must exist and be ACTIVE (a suspended or not-yet-onboarded organisation
    // cannot receive new requests). The candidate never supplies a member or issuer key.
    const organisation = await tx.organisation.findFirst({
      where: { id: input.organisationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!organisation) {
      throw new DomainError("VALIDATION", "Choose a registered, active organisation.", { organisationId: "Choose a registered, active organisation." });
    }
    if (claim.organisationId && claim.organisationId !== organisation.id) {
      throw new DomainError("CONFLICT", "This claim is linked to a different organisation.");
    }

    // Already issued or already approved for this exact version: nothing more to request.
    const issued = await tx.credential.findFirst({ where: { claimVersionId: version.id }, select: { id: true } });
    const approved = await tx.verificationRequest.findFirst({ where: { claimVersionId: version.id, status: "APPROVED" }, select: { id: true } });
    if (issued || approved) throw new DomainError("CONFLICT", "This version has already been approved.");

    try {
      const request = await tx.verificationRequest.create({
        data: {
          claimVersionId: version.id,
          organisationId: organisation.id,
          candidateId: actor.userId,
          institutionalIdentifier: identifier || null,
          candidateNote: note || null,
        },
        select: { id: true, status: true },
      });
      if (!claim.organisationId) {
        await tx.claim.update({ where: { id: claim.id }, data: { organisationId: organisation.id } });
      }
      await audit(tx, actor, "REQUEST_SUBMITTED", "VerificationRequest", request.id, {
        claimId: claim.id,
        claimVersionId: version.id,
        organisationId: organisation.id,
      });
      return { requestId: request.id, claimVersionId: version.id, status: request.status };
    } catch (e) {
      // Partial unique index: at most one open request per ClaimVersion.
      if (isUniqueViolation(e)) throw new DomainError("CONFLICT", "There is already an open verification request for this version.");
      throw e;
    }
  });
}

export async function withdrawVerificationRequest(db: ClaimsDb, actor: Actor, requestId: string) {
  assertCandidate(actor);
  if (!isUuid(requestId)) throw new DomainError("NOT_FOUND", "Request not found.");

  return inTransaction(db, async (tx) => {
    const request = await tx.verificationRequest.findFirst({
      where: { id: requestId, candidateId: actor.userId },
      select: { id: true, status: true },
    });
    if (!request) throw new DomainError("NOT_FOUND", "Request not found.");

    // Conditional update: if an issuer decided in the meantime, nothing is withdrawn.
    const { count } = await tx.verificationRequest.updateMany({
      where: { id: request.id, candidateId: actor.userId, status: { in: [...OPEN_STATUSES] } },
      data: { status: "WITHDRAWN", closedAt: new Date() },
    });
    if (count !== 1) throw new DomainError("CONFLICT", "This request is no longer open, so it cannot be withdrawn.");

    await audit(tx, actor, "REQUEST_WITHDRAWN", "VerificationRequest", request.id, { previousStatus: request.status });
    return { requestId: request.id, status: "WITHDRAWN" as const };
  });
}
