import { SCHEMA_ID } from "@/lib/crypto/constants";
import { dateToUnixSeconds } from "@/lib/crypto/encoding";
import { cohortLeafHash, verifyCohortProof } from "@/lib/merkle/cohort";
import {
  anchorCommonOutcomes,
  isFinalAnchor,
  pendingOutcome,
  record,
  verifyChainPrefix,
  windowOutcome,
  type Collector,
  type LifecycleOutcome,
  type PathAssessment,
} from "./evidence";
import type { CredentialEvidence, SignedMaterial, VerificationPolicy } from "./types";

// CohortProof evidence path, shared by PERMANENT and EXPIRING credentials (DOMAIN_MODEL §4, MERKLE_MODEL §2).
// A positive result needs ALL of: the leaf rebuilt from the signed material equals the stored leaf; the
// stored sibling path folds to the batch root; a FINALIZED COHORT anchor of the SAME organisation carries
// exactly that root and leaf count; the organisation's COHORT chain is continuous up to that anchor; and
// the first anchor falls inside `issuedAt <= anchoredAt <= issuedAt + maxAnchorDelay`.

export function assessCohortPath(ev: CredentialEvidence, m: SignedMaterial, policy: VerificationPolicy, c: Collector): PathAssessment {
  const cohort = ev.cohort;
  if (!cohort) {
    c.check("MERKLE_LEAF", "PENDING", "The credential has not been queued in a cohort batch yet.");
    c.reason("AWAITING_ANCHOR");
    return { status: "NONE", reason: "AWAITING_ANCHOR" };
  }

  const leaf = (() => {
    try {
      return cohortLeafHash({
        orgId: m.orgId,
        credentialId: m.credentialId,
        subjectCommitment: m.subjectCommitment,
        contentDigest: m.contentDigest,
        lifecycleType: m.lifecycleType === "PERMANENT" ? 0 : 2,
        validFrom: dateToUnixSeconds(m.validFrom),
        validUntil: m.validUntil ? dateToUnixSeconds(m.validUntil) : 0n,
        issuedAt: dateToUnixSeconds(m.issuedAt),
        schemaId: SCHEMA_ID,
      });
    } catch {
      return null;
    }
  })();
  if (record(c, [{ id: "MERKLE_LEAF", ok: leaf !== null && leaf === cohort.leafHash, detail: "The tree leaf equals the leaf rebuilt from the signed credential.", reason: "MERKLE_PROOF_INVALID" }]).length > 0) {
    return { status: "INVALID" };
  }

  const batch = cohort.batch;
  if (!batch.anchorId || !batch.batchRoot) {
    c.check("ANCHOR_PRESENT", "PENDING", "The batch has not been anchored yet.");
    c.reason("AWAITING_ANCHOR");
    return { status: "NONE", reason: "AWAITING_ANCHOR" };
  }
  const anchor = ev.anchors.find((a) => a.id === batch.anchorId);
  if (!anchor) {
    c.check("ANCHOR_PRESENT", "PENDING", "The batch's anchor is not available.");
    c.reason("AWAITING_ANCHOR");
    return { status: "NONE", reason: "AWAITING_ANCHOR" };
  }
  // Only FINALIZED chain evidence counts (D17).
  if (!isFinalAnchor(anchor)) {
    c.check("ANCHOR_FINAL", "PENDING", "The anchor transaction is not yet finalised.");
    c.reason("ANCHOR_NOT_FINAL");
    return { status: "NONE", reason: "ANCHOR_NOT_FINAL" };
  }
  c.check("ANCHOR_FINAL", "PASS", "The anchor transaction is finalised.");

  const failures = record(c, [
    ...anchorCommonOutcomes(anchor, m.organisationId, "COHORT", policy),
    {
      id: "ANCHOR_ROOT",
      ok: anchor.batchRoot === batch.batchRoot && anchor.leafCount === batch.leafCount,
      detail: "The anchored root and leaf count equal the sealed batch.",
      reason: "ANCHOR_ROOT_MISMATCH",
    },
    {
      id: "MERKLE_PROOF",
      ok: cohort.proof !== null && verifyCohortProof(anchor.batchRoot, cohort.leafHash, cohort.proof),
      detail: "The inclusion proof folds to the anchored root.",
      reason: "MERKLE_PROOF_INVALID",
    },
  ]);
  if (failures.length > 0) return { status: "INVALID" };

  const chain = verifyChainPrefix(ev.anchors, m.organisationId, m.orgId, "COHORT", anchor.epoch);
  if (chain.status === "BROKEN") {
    record(c, [{ id: "ANCHOR_CHAIN_CONTINUITY", ok: false, detail: chain.detail, reason: "ANCHOR_CHAIN_BROKEN" }]);
    return { status: "INVALID" };
  }
  if (chain.status === "GAP") {
    c.check("ANCHOR_CHAIN_CONTINUITY", "PENDING", chain.detail);
    c.reason("ANCHOR_CHAIN_INCOMPLETE");
    return { status: "NONE", reason: "ANCHOR_CHAIN_INCOMPLETE" };
  }
  c.check("ANCHOR_CHAIN_CONTINUITY", "PASS", chain.detail);

  if (record(c, [windowOutcome(m.issuedAt, anchor.blockTimestamp, policy)]).length > 0) return { status: "INVALID" };
  return { status: "OK", first: anchor, latestActive: null };
}

/** E: PERMANENT → PERMANENT_VALID once the evidence qualifies. Time passing never changes it. */
export function derivePermanent(path: PathAssessment, m: SignedMaterial, policy: VerificationPolicy, now: Date, c: Collector): LifecycleOutcome {
  if (path.status === "OK") {
    c.reason("VALID_PERMANENT");
    return { state: "PERMANENT_VALID", evidenceTimestamp: path.first.blockTimestamp };
  }
  if (path.status === "NONE") return pendingOutcome(path, m, policy, now, c);
  return { state: "INVALID_PROOF" }; // unreachable: INVALID is handled before the lifecycle step
}
