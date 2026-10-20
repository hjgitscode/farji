import type { Actor } from "@/lib/auth/authorize";
import { readContent } from "@/lib/core/claims";
import { deriveClaimState, deriveCredentialState } from "@/lib/verification/derive";
import { EARLIER_VERIFIED_STATES } from "@/lib/verification/summary";
import type { ClaimEvidence, VerificationResult } from "@/lib/verification/types";
import { DomainError } from "@/server/candidate/errors";
import { loadCredentialEvidence, newLoadCache, type VerificationDb } from "./load";
import { policyFactory, type VerificationOptions } from "./service";

// The candidate's own records with their DERIVED states, version history and the "earlier version was verified" note
// (ROADMAP Phase 11). Read-only. Every state comes from the Phase 10 engine; nothing here decides or stores a verification.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN = ["SUBMITTED", "IN_REVIEW", "APPROVED"] as const;

export type RecordDb = VerificationDb;

export type RecordVersion = {
  versionId: string;
  versionNumber: number;
  createdAt: Date;
  content: ReturnType<typeof readContent>;
  proposedLifecycleType: string;
  /** The derived state of THIS version's credential, or null when it never had one. */
  credentialResult: VerificationResult | null;
};

export type CandidateRecord = {
  claimId: string;
  category: string;
  visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
  archivedAt: Date | null;
  createdAt: Date;
  current: RecordVersion;
  /** Derived state of the claim as shown on a profile (current version). Null only when verification is unavailable. */
  result: VerificationResult | null;
  versions: RecordVersion[];
  /** Set when an EARLIER version was verified but the current one is not (yet): shown as a note, never as a badge. */
  earlierVerified: { versionNumber: number; organisationName: string | null } | null;
  /** Public verifier reference of the current version's signed credential, if any. */
  credentialRef: string | null;
};

/** The candidate's records with derived states. Scoped by `actor.userId`; `claimIds` only narrows within the candidate's own. */
export async function deriveCandidateRecords(
  db: RecordDb,
  actor: Actor,
  claimIds?: string[],
  opts: VerificationOptions = {},
): Promise<{ available: boolean; records: CandidateRecord[] }> {
  if (!actor || actor.role !== "CANDIDATE" || !UUID.test(actor.userId ?? "")) throw new DomainError("FORBIDDEN", "Only a candidate can do this.");
  const policyFor = policyFactory(opts.domain);
  const now = opts.now ?? new Date();

  const claims = await db.claim.findMany({
    where: { candidateId: actor.userId, ...(claimIds ? { id: { in: claimIds.filter((id) => UUID.test(id)) } } : {}) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      category: true,
      visibility: true,
      archivedAt: true,
      createdAt: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        select: {
          id: true,
          versionNumber: true,
          createdAt: true,
          content: true,
          proposedLifecycleType: true,
          credential: { select: { id: true } },
          // Workflow status feeds PENDING only; notes and references are never selected.
          verificationRequests: { select: { status: true, organisation: { select: { id: true, displayName: true } } }, orderBy: { submittedAt: "desc" } },
        },
      },
    },
  });

  const cache = newLoadCache();
  const records = await Promise.all(
    claims.map(async (claim): Promise<CandidateRecord | null> => {
      const latest = claim.versions[0];
      if (!latest) return null;

      const versions: RecordVersion[] = [];
      let currentResult: VerificationResult | null = null;
      for (const v of claim.versions) {
        let credentialResult: VerificationResult | null = null;
        let evidence = null;
        let freshness = 45;
        if (v.credential && policyFor) {
          const loaded = await loadCredentialEvidence(db, v.credential.id, cache);
          if (loaded) {
            evidence = loaded.evidence;
            freshness = loaded.pulseFreshnessDays;
            credentialResult = deriveCredentialState(loaded.evidence, now, policyFor(loaded.pulseFreshnessDays));
          }
        }
        versions.push({ versionId: v.id, versionNumber: v.versionNumber, createdAt: v.createdAt, content: readContent(v.content), proposedLifecycleType: v.proposedLifecycleType, credentialResult });

        if (v.id === latest.id && policyFor) {
          const open = v.verificationRequests.find((r) => (OPEN as readonly string[]).includes(r.status));
          const claimEvidence: ClaimEvidence = {
            claimId: claim.id,
            proposedLifecycleType: v.proposedLifecycleType,
            requestInProgress: !!open,
            requestedOrganisation: open ? open.organisation : null,
            credential: evidence,
          };
          currentResult = deriveClaimState(claimEvidence, now, policyFor(freshness));
        }
      }

      const currentState = currentResult?.state;
      let earlierVerified: CandidateRecord["earlierVerified"] = null;
      if (currentState === "SELF_DECLARED" || currentState === "PENDING") {
        const earlier = versions.slice(1).find((v) => v.credentialResult && EARLIER_VERIFIED_STATES.includes(v.credentialResult.state));
        if (earlier) earlierVerified = { versionNumber: earlier.versionNumber, organisationName: earlier.credentialResult?.organisation?.displayName ?? null };
      }

      return {
        claimId: claim.id,
        category: claim.category,
        visibility: claim.visibility,
        archivedAt: claim.archivedAt,
        createdAt: claim.createdAt,
        current: versions[0],
        result: currentResult,
        versions,
        earlierVerified,
        credentialRef: currentResult?.credentialId ?? null,
      };
    }),
  );
  return { available: !!policyFor, records: records.filter((r): r is CandidateRecord => r !== null) };
}

/**
 * Derived states of an ISSUER'S OWN organisation's credentials (verification history). The organisation comes from
 * the actor (the guard), never from input. Returns only identifiers and states the issuer is entitled to see.
 */
export async function deriveIssuerHistory(db: RecordDb, actor: Actor, opts: VerificationOptions = {}) {
  if (!actor || actor.role !== "ISSUER" || !actor.organisationId || !UUID.test(actor.organisationId)) throw new DomainError("FORBIDDEN", "Only an issuer of an organisation can do this.");
  const policyFor = policyFactory(opts.domain);
  const now = opts.now ?? new Date();
  const credentials = await db.credential.findMany({
    where: { organisationId: actor.organisationId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, lifecycleType: true, claimVersion: { select: { versionNumber: true, content: true, claim: { select: { category: true } } } } },
  });
  const cache = newLoadCache();
  const rows = await Promise.all(
    credentials.map(async (c) => {
      let result: VerificationResult | null = null;
      if (policyFor) {
        const loaded = await loadCredentialEvidence(db, c.id, cache);
        if (loaded) result = deriveCredentialState(loaded.evidence, now, policyFor(loaded.pulseFreshnessDays));
      }
      return { id: c.id, lifecycleType: c.lifecycleType, category: c.claimVersion.claim.category, versionNumber: c.claimVersion.versionNumber, content: readContent(c.claimVersion.content), result };
    }),
  );
  return { available: !!policyFor, rows };
}
