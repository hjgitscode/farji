import { readContent } from "@/lib/core/claims";
import { buildProofBundle, type ProofBundle } from "@/lib/verification/bundle";
import { deriveClaimState, deriveCredentialState } from "@/lib/verification/derive";
import { publicGroupOf, type PublicGroup } from "@/lib/verification/summary";
import type { ClaimEvidence, VerificationResult } from "@/lib/verification/types";
import { HANDLE_PATTERN } from "@/server/candidate/profile";
import { loadCredentialEvidence, newLoadCache, type VerificationDb } from "@/server/verification/load";
import { policyFactory, type VerificationOptions } from "@/server/verification/service";

// PUBLIC read services (ROADMAP Phase 13). No actor: everything here is reachable by anyone, so the rules are in the
// queries: only records the candidate chose to publish are ever read, a private or missing thing is answered with the
// same `null`, and no identifier of a user, claim or request is returned. Every state is the Phase 10 derivation.

const BYTES32 = /^0x[0-9a-f]{64}$/;

export type PublicRecord = {
  /** Position within the profile (not an identifier). */
  index: number;
  category: string;
  title: string;
  organisationName: string;
  startDate: string;
  endDate: string;
  expiryDate: string;
  description: string;
  location: string;
  fieldOfStudy: string;
  credentialNumber: string;
  lifecycleType: string;
  group: PublicGroup;
  /** The Phase 10 result. For a pending record the organisation is withheld. */
  result: VerificationResult;
  /** Link target for the public verifier; only for records with a signed credential. */
  verifyRef: string | null;
};

export type PublicProfileView = {
  handle: string;
  displayName: string;
  headline: string | null;
  about: string | null;
  location: string | null;
  /** UNLISTED profiles resolve by link but must not be indexed. */
  indexable: boolean;
  available: boolean;
  records: PublicRecord[];
};

const OPEN = ["SUBMITTED", "IN_REVIEW", "APPROVED"] as const;

/** A public profile, or null if the handle is malformed, unknown or the profile is PRIVATE (indistinguishable). */
export async function getPublicProfile(db: VerificationDb, handleInput: unknown, opts: VerificationOptions = {}): Promise<PublicProfileView | null> {
  const handle = typeof handleInput === "string" ? handleInput.toLowerCase() : "";
  if (!HANDLE_PATTERN.test(handle)) return null;
  const profile = await db.profile.findUnique({ where: { handle }, select: { userId: true, handle: true, displayName: true, headline: true, about: true, location: true, visibility: true } });
  if (!profile || profile.visibility === "PRIVATE") return null;

  const policyFor = policyFactory(opts.domain);
  const now = opts.now ?? new Date();
  const claims = await db.claim.findMany({
    // ONLY records the candidate marked PUBLIC are listed; UNLISTED and PRIVATE ones never appear here.
    where: { candidateId: profile.userId, visibility: "PUBLIC", archivedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      category: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { content: true, proposedLifecycleType: true, credential: { select: { id: true } }, verificationRequests: { select: { status: true } } },
      },
    },
  });

  const cache = newLoadCache();
  const records: PublicRecord[] = [];
  if (policyFor) {
    for (const claim of claims) {
      const v = claim.versions[0];
      if (!v) continue;
      let evidence = null;
      let freshness = 45;
      if (v.credential) {
        const loaded = await loadCredentialEvidence(db, v.credential.id, cache);
        if (loaded) {
          evidence = loaded.evidence;
          freshness = loaded.pulseFreshnessDays;
        }
      }
      const claimEvidence: ClaimEvidence = {
        claimId: "",
        proposedLifecycleType: v.proposedLifecycleType,
        requestInProgress: v.verificationRequests.some((r) => (OPEN as readonly string[]).includes(r.status)),
        requestedOrganisation: null, // an in-progress request is not attributed publicly
        credential: evidence,
      };
      const derived = deriveClaimState(claimEvidence, now, policyFor(freshness));
      const result: VerificationResult = derived.state === "PENDING" ? { ...derived, organisation: null } : derived;
      const c = readContent(v.content);
      records.push({
        index: records.length,
        category: claim.category,
        title: c.title ?? "",
        organisationName: c.organisationName ?? "",
        startDate: c.startDate ?? "",
        endDate: c.endDate ?? "",
        expiryDate: c.expiryDate ?? "",
        description: c.description ?? "",
        location: c.location ?? "",
        fieldOfStudy: c.fieldOfStudy ?? "",
        credentialNumber: c.credentialNumber ?? "",
        lifecycleType: result.lifecycleType ?? v.proposedLifecycleType,
        group: publicGroupOf(result.state),
        result,
        verifyRef: result.credentialId && result.state !== "SELF_DECLARED" && result.state !== "PENDING" ? result.credentialId : null,
      });
    }
  }
  return {
    handle: profile.handle,
    displayName: profile.displayName,
    headline: profile.headline,
    about: profile.about,
    location: profile.location,
    indexable: profile.visibility === "PUBLIC",
    available: !!policyFor,
    records,
  };
}

export type PublicCredentialView = {
  record: {
    category: string;
    title: string;
    organisationName: string;
    startDate: string;
    endDate: string;
    expiryDate: string;
    description: string;
    location: string;
    fieldOfStudy: string;
    credentialNumber: string;
  };
  result: VerificationResult;
  holder: { displayName: string; handle: string | null } | null;
  /** False when the holder has since created a newer version of the record. */
  isCurrentVersion: boolean;
  bundle: ProofBundle | null;
};

export function parseCredentialRef(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().toLowerCase();
  return BYTES32.test(t) ? t : null;
}

/**
 * The public verifier's data for one credential reference, or null when it is malformed, unknown, or the holder did not
 * publish the record (all indistinguishable). The state comes from the Phase 10 engine over the loaded evidence.
 */
export async function getPublicCredential(db: VerificationDb, refInput: unknown, opts: VerificationOptions = {}): Promise<PublicCredentialView | null> {
  const ref = parseCredentialRef(refInput);
  if (!ref) return null;
  const policyFor = policyFactory(opts.domain);
  if (!policyFor) return null;
  const now = opts.now ?? new Date();

  const row = await db.credential.findUnique({
    where: { credentialId: ref },
    select: {
      id: true,
      claimVersion: {
        select: {
          versionNumber: true,
          content: true,
          claim: {
            select: {
              category: true,
              visibility: true,
              archivedAt: true,
              versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { versionNumber: true } },
              candidate: { select: { profile: { select: { displayName: true, handle: true, visibility: true } } } },
            },
          },
        },
      },
    },
  });
  // PRIVATE (the default) is the same as unknown.
  if (!row || row.claimVersion.claim.visibility === "PRIVATE") return null;

  const loaded = await loadCredentialEvidence(db, row.id);
  if (!loaded) return null;
  const policy = policyFor(loaded.pulseFreshnessDays);
  const result = deriveCredentialState(loaded.evidence, now, policy);

  const anchorIds = loaded.evidence.anchors.map((a) => a.id);
  const anchors = anchorIds.length
    ? await db.anchor.findMany({ where: { id: { in: anchorIds } }, select: { id: true, blockNumber: true, transaction: { select: { txHash: true } } } })
    : [];
  const anchorTx = Object.fromEntries(anchors.map((a) => [a.id, { transactionHash: a.transaction.txHash, blockNumber: a.blockNumber.toString() }]));
  const rev = result.state === "REVOKED" ? await db.revocation.findUnique({ where: { credentialRowId: row.id }, select: { blockNumber: true, transaction: { select: { txHash: true } } } }) : null;

  const bundle = buildProofBundle({
    evidence: loaded.evidence,
    result,
    domain: policy.domain,
    now,
    anchorTx,
    revocationTx: rev ? { transactionHash: rev.transaction.txHash, blockNumber: rev.blockNumber.toString() } : null,
  });

  const c = readContent(row.claimVersion.content);
  const claim = row.claimVersion.claim;
  const profile = claim.candidate.profile;
  return {
    record: {
      category: claim.category,
      title: c.title ?? "",
      organisationName: c.organisationName ?? "",
      startDate: c.startDate ?? "",
      endDate: c.endDate ?? "",
      expiryDate: c.expiryDate ?? "",
      description: c.description ?? "",
      location: c.location ?? "",
      fieldOfStudy: c.fieldOfStudy ?? "",
      credentialNumber: c.credentialNumber ?? "",
    },
    result,
    // The holder's name is shown only if they published a profile; the handle link only if that profile and record are listed.
    holder: profile && profile.visibility !== "PRIVATE" ? { displayName: profile.displayName, handle: claim.visibility === "PUBLIC" ? profile.handle : null } : null,
    isCurrentVersion: claim.versions[0]?.versionNumber === row.claimVersion.versionNumber,
    bundle,
  };
}
