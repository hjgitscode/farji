import type { Actor } from "@/lib/auth/authorize";
import type { Eip712Config } from "@/lib/crypto/eip712";
import { deriveClaimState, deriveCredentialState } from "@/lib/verification/derive";
import type { ClaimEvidence, VerificationPolicy, VerificationResult } from "@/lib/verification/types";
import { MAX_ANCHOR_DELAY_SECONDS } from "@/server/chain/policy";
import { DomainError } from "@/server/candidate/errors";
import { getEip712Config } from "@/server/issuance/config";
import { loadCredentialEvidence, newLoadCache, type LoadCache, type VerificationDb } from "./load";

// Verification service (ROADMAP Phase 10): assembles trusted evidence from the database mirror and hands it to
// the pure engine. Nothing is stored: the state is recomputed on every call (DOMAIN_MODEL §6.4 caching is
// optional and not used). Business policy comes from here and from the Organisation row, never from the engine.

export type VerificationOptions = {
  now?: Date;
  /** The EIP-712 domain to verify against; defaults to the configured chain + registry (no default exists). */
  domain?: Eip712Config;
};

export type PolicyFor = (pulseFreshnessDays: number) => VerificationPolicy;

/** Builds the policy factory, or returns null when the chain/registry is not configured. */
export function policyFactory(domain?: Eip712Config): PolicyFor | null {
  let resolved = domain;
  if (!resolved) {
    try {
      resolved = getEip712Config();
    } catch {
      return null; // chain features off: verification cannot be evaluated, and must not guess a domain
    }
  }
  const d = resolved;
  return (pulseFreshnessDays) => ({ maxAnchorDelayMs: MAX_ANCHOR_DELAY_SECONDS * 1000, pulseFreshnessDays, domain: d });
}

/**
 * The derived state of one Credential row. No authorisation: the result is the public-safe shape (no salts,
 * notes or private references). Callers that expose it to a user must establish their own right to the row.
 */
export async function deriveStateForCredential(db: VerificationDb, credentialRowId: string, opts: VerificationOptions = {}, cache: LoadCache = newLoadCache()): Promise<VerificationResult | null> {
  const policyFor = policyFactory(opts.domain);
  if (!policyFor) throw new DomainError("CONFLICT", "Verification is unavailable until the chain and registry are configured.");
  const loaded = await loadCredentialEvidence(db, credentialRowId, cache);
  if (!loaded) return null;
  return deriveCredentialState(loaded.evidence, opts.now ?? new Date(), policyFor(loaded.pulseFreshnessDays));
}

const OPEN = ["SUBMITTED", "IN_REVIEW", "APPROVED"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Derived states for a candidate's OWN claims (DOMAIN_MODEL §6.2). The claim list is scoped by `actor.userId`;
 * another candidate's claim is simply absent. Returns an empty map (and `available: false`) when verification is
 * not configured, so a page can say "unavailable" instead of guessing a state.
 */
export async function deriveCandidateClaimStates(
  db: VerificationDb,
  actor: Actor,
  claimIds?: string[],
  opts: VerificationOptions = {},
): Promise<{ available: boolean; states: Map<string, VerificationResult> }> {
  if (!actor || actor.role !== "CANDIDATE" || !UUID.test(actor.userId)) throw new DomainError("FORBIDDEN", "Only a candidate can do this.");
  const policyFor = policyFactory(opts.domain);
  if (!policyFor) return { available: false, states: new Map() };
  const now = opts.now ?? new Date();

  const claims = await db.claim.findMany({
    where: { candidateId: actor.userId, ...(claimIds ? { id: { in: claimIds.filter((id) => UUID.test(id)) } } : {}) },
    select: {
      id: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: {
          id: true,
          proposedLifecycleType: true,
          credential: { select: { id: true } },
          // Workflow status feeds PENDING only; notes and references are never selected.
          verificationRequests: { select: { status: true, submittedAt: true, organisation: { select: { id: true, displayName: true } } }, orderBy: { submittedAt: "desc" } },
        },
      },
    },
  });

  const cache = newLoadCache();
  const states = new Map<string, VerificationResult>();
  await Promise.all(
    claims.map(async (claim) => {
      const version = claim.versions[0];
      if (!version) return;
      const open = version.verificationRequests.find((r) => (OPEN as readonly string[]).includes(r.status));
      let credential = null;
      let freshnessDays = 45; // only used for the (credential-less) PENDING/SELF_DECLARED results, which never read it
      if (version.credential) {
        const loaded = await loadCredentialEvidence(db, version.credential.id, cache);
        if (loaded) {
          credential = loaded.evidence;
          freshnessDays = loaded.pulseFreshnessDays;
        }
      }
      const evidence: ClaimEvidence = {
        claimId: claim.id,
        proposedLifecycleType: version.proposedLifecycleType,
        requestInProgress: !!open,
        requestedOrganisation: open ? open.organisation : null,
        credential,
      };
      states.set(claim.id, deriveClaimState(evidence, now, policyFor(freshnessDays)));
    }),
  );
  return { available: true, states };
}
